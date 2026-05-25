use std::sync::Mutex;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPowerStatus {
    pub supported: bool,
    pub keep_awake: bool,
    pub keep_display_awake: bool,
}

#[derive(Default)]
pub struct DesktopPowerManager {
    state: Mutex<PowerState>,
}

impl DesktopPowerManager {
    pub fn status(&self) -> Result<DesktopPowerStatus, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Desktop power state is unavailable".to_string())?;
        Ok(DesktopPowerStatus {
            supported: platform::SUPPORTED,
            keep_awake: state.keep_awake,
            keep_display_awake: state.keep_display_awake,
        })
    }

    pub fn apply(
        &self,
        keep_awake: bool,
        keep_display_awake: bool,
    ) -> Result<DesktopPowerStatus, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Desktop power state is unavailable".to_string())?;

        let effective_keep_awake = keep_awake || keep_display_awake;
        state.apply(effective_keep_awake, keep_display_awake)?;

        Ok(DesktopPowerStatus {
            supported: platform::SUPPORTED,
            keep_awake: state.keep_awake,
            keep_display_awake: state.keep_display_awake,
        })
    }
}

#[derive(Default)]
struct PowerState {
    keep_awake: bool,
    keep_display_awake: bool,
    assertions: platform::PowerAssertions,
}

impl PowerState {
    fn apply(&mut self, keep_awake: bool, keep_display_awake: bool) -> Result<(), String> {
        self.assertions.apply(keep_awake, keep_display_awake)?;
        self.keep_awake = keep_awake && platform::SUPPORTED;
        self.keep_display_awake = keep_display_awake && platform::SUPPORTED;
        Ok(())
    }
}

#[tauri::command]
pub fn desktop_power_status(
    manager: tauri::State<'_, DesktopPowerManager>,
) -> Result<DesktopPowerStatus, String> {
    manager.status()
}

#[tauri::command]
pub fn set_desktop_power_settings(
    keep_awake: bool,
    keep_display_awake: bool,
    manager: tauri::State<'_, DesktopPowerManager>,
) -> Result<DesktopPowerStatus, String> {
    manager.apply(keep_awake, keep_display_awake)
}

#[cfg(target_os = "macos")]
mod platform {
    use std::ffi::CString;
    use std::os::raw::{c_char, c_void};

    pub const SUPPORTED: bool = true;

    type CFStringRef = *const c_void;
    type CFAllocatorRef = *const c_void;
    type IOReturn = i32;
    type IOPMAssertionID = u32;
    type IOPMAssertionLevel = u32;

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    const K_IOPM_ASSERTION_LEVEL_ON: IOPMAssertionLevel = 255;
    const K_IOPM_ASSERT_PREVENT_USER_IDLE_SYSTEM_SLEEP: &str = "PreventUserIdleSystemSleep";
    const K_IOPM_ASSERT_PREVENT_USER_IDLE_DISPLAY_SLEEP: &str = "PreventUserIdleDisplaySleep";

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(
            alloc: CFAllocatorRef,
            c_str: *const c_char,
            encoding: u32,
        ) -> CFStringRef;
        fn CFRelease(cf: *const c_void);
    }

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPMAssertionCreateWithName(
            assertion_type: CFStringRef,
            assertion_level: IOPMAssertionLevel,
            assertion_name: CFStringRef,
            assertion_id: *mut IOPMAssertionID,
        ) -> IOReturn;

        fn IOPMAssertionRelease(assertion_id: IOPMAssertionID) -> IOReturn;
    }

    #[derive(Default)]
    pub struct PowerAssertions {
        system_assertion_id: Option<IOPMAssertionID>,
        display_assertion_id: Option<IOPMAssertionID>,
    }

    impl PowerAssertions {
        pub fn apply(&mut self, keep_awake: bool, keep_display_awake: bool) -> Result<(), String> {
            self.set_system_assertion(keep_awake)?;
            self.set_display_assertion(keep_display_awake)?;
            Ok(())
        }

        fn set_system_assertion(&mut self, enabled: bool) -> Result<(), String> {
            if enabled && self.system_assertion_id.is_none() {
                self.system_assertion_id = Some(create_assertion(
                    K_IOPM_ASSERT_PREVENT_USER_IDLE_SYSTEM_SLEEP,
                    "Animus is keeping this computer awake",
                )?);
            } else if !enabled {
                release_assertion(&mut self.system_assertion_id);
            }
            Ok(())
        }

        fn set_display_assertion(&mut self, enabled: bool) -> Result<(), String> {
            if enabled && self.display_assertion_id.is_none() {
                self.display_assertion_id = Some(create_assertion(
                    K_IOPM_ASSERT_PREVENT_USER_IDLE_DISPLAY_SLEEP,
                    "Animus is keeping this display awake",
                )?);
            } else if !enabled {
                release_assertion(&mut self.display_assertion_id);
            }
            Ok(())
        }
    }

    impl Drop for PowerAssertions {
        fn drop(&mut self) {
            release_assertion(&mut self.display_assertion_id);
            release_assertion(&mut self.system_assertion_id);
        }
    }

    fn create_assertion(assertion_type: &str, name: &str) -> Result<IOPMAssertionID, String> {
        let cf_assertion_type = create_cf_string(
            assertion_type,
            "Power assertion type is invalid",
            "Could not create macOS power assertion type",
        )?;
        let cf_name = match create_cf_string(
            name,
            "Power assertion name is invalid",
            "Could not create macOS power assertion name",
        ) {
            Ok(value) => value,
            Err(err) => {
                unsafe {
                    CFRelease(cf_assertion_type);
                }
                return Err(err);
            }
        };

        let mut assertion_id: IOPMAssertionID = 0;
        let result = unsafe {
            IOPMAssertionCreateWithName(
                cf_assertion_type,
                K_IOPM_ASSERTION_LEVEL_ON,
                cf_name,
                &mut assertion_id,
            )
        };
        unsafe {
            CFRelease(cf_name);
            CFRelease(cf_assertion_type);
        }

        if result == 0 {
            Ok(assertion_id)
        } else {
            Err(format!("macOS power assertion failed with code {}", result))
        }
    }

    fn create_cf_string(
        value: &str,
        invalid_message: &str,
        null_message: &str,
    ) -> Result<CFStringRef, String> {
        let c_value = CString::new(value).map_err(|_| invalid_message.to_string())?;
        let cf_value = unsafe {
            CFStringCreateWithCString(
                std::ptr::null(),
                c_value.as_ptr(),
                K_CF_STRING_ENCODING_UTF8,
            )
        };
        if cf_value.is_null() {
            Err(null_message.to_string())
        } else {
            Ok(cf_value)
        }
    }

    fn release_assertion(assertion_id: &mut Option<IOPMAssertionID>) {
        if let Some(id) = assertion_id.take() {
            unsafe {
                IOPMAssertionRelease(id);
            }
        }
    }
}

#[cfg(windows)]
mod platform {
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };

    pub const SUPPORTED: bool = true;

    #[derive(Default)]
    pub struct PowerAssertions;

    impl PowerAssertions {
        pub fn apply(&mut self, keep_awake: bool, keep_display_awake: bool) -> Result<(), String> {
            let mut flags = ES_CONTINUOUS;
            if keep_awake || keep_display_awake {
                flags |= ES_SYSTEM_REQUIRED;
            }
            if keep_display_awake {
                flags |= ES_DISPLAY_REQUIRED;
            }

            let previous = unsafe { SetThreadExecutionState(flags) };
            if previous == 0 {
                Err("Windows rejected the power request".to_string())
            } else {
                Ok(())
            }
        }
    }

    impl Drop for PowerAssertions {
        fn drop(&mut self) {
            unsafe {
                SetThreadExecutionState(ES_CONTINUOUS);
            }
        }
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    pub const SUPPORTED: bool = false;

    #[derive(Default)]
    pub struct PowerAssertions;

    impl PowerAssertions {
        pub fn apply(
            &mut self,
            _keep_awake: bool,
            _keep_display_awake: bool,
        ) -> Result<(), String> {
            Ok(())
        }
    }
}
