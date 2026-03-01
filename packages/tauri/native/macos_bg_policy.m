/**
 * macOS Background Policy Native Addon
 *
 * Suppresses the "exec" dock icon for Node.js child processes on macOS.
 *
 * Strategy (multi-layer, tries strongest first):
 *   1. AppKit: [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited]
 *      Strongest suppression. Declares the process as fully background.
 *   2. AppKit fallback: Try .accessory (LSUIElement) if .prohibited fails.
 *   3. Carbon fallback: TransformProcessType(kProcessTransformToBackgroundApplication)
 *      Deprecated but may still work for non-Cocoa binaries (e.g., ripgrep).
 *
 * Includes verification readback: after setting the policy, reads it back to
 * confirm the system actually applied it (detects macOS versions where the API
 * returns YES but doesn't actually change the underlying state).
 *
 * Build (universal binary):
 *   clang -shared -undefined dynamic_lookup \
 *     -framework AppKit -framework ApplicationServices \
 *     -arch arm64 -arch x86_64 \
 *     -o macos_bg_policy.node macos_bg_policy.m
 */

#import <AppKit/AppKit.h>
#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
#include <time.h>

/* Convert NSApplicationActivationPolicy to human-readable string */
static const char *policy_name(NSApplicationActivationPolicy p) {
    switch (p) {
        case NSApplicationActivationPolicyRegular:    return "regular";
        case NSApplicationActivationPolicyAccessory:  return "accessory";
        case NSApplicationActivationPolicyProhibited: return "prohibited";
        default:                                      return "unknown";
    }
}

__attribute__((constructor))
static void suppress_dock_icon(void) {
    int ok = 0;
    const char *method = "none";
    const char *verified = "n/a";
    NSApplicationActivationPolicy readback_policy = -1;
    NSApplicationActivationPolicy initial_policy = -1;

    /* Strategy 1: AppKit — prohibited (strongest background mode) */
    NSApplication *app = [NSApplication sharedApplication];
    if (app) {
        /* Read the initial policy before we change it */
        initial_policy = [NSApp activationPolicy];

        if ([NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited]) {
            ok = 1;
            method = "prohibited";
        }
        /* Strategy 2: AppKit — accessory (LSUIElement, no dock but can have UI) */
        else if ([NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory]) {
            ok = 1;
            method = "accessory";
        }

        /* Verification: read the policy back to confirm it was actually applied.
           On some macOS versions the set call returns YES but the underlying
           state doesn't change. */
        if (ok) {
            readback_policy = [NSApp activationPolicy];
            NSApplicationActivationPolicy expected =
                (method[0] == 'p') ? NSApplicationActivationPolicyProhibited
                                   : NSApplicationActivationPolicyAccessory;
            verified = (readback_policy == expected) ? "yes" : "MISMATCH";
        }
    }

    /* Strategy 3: Carbon fallback for non-Cocoa binaries (e.g., ripgrep).
       Deprecated but may still work on some macOS versions. */
    if (!ok) {
        ProcessSerialNumber psn = { 0, kCurrentProcess };
        OSStatus err = TransformProcessType(&psn, kProcessTransformToBackgroundApplication);
        if (err == noErr) {
            ok = 1;
            method = "carbon";
            verified = "n/a";
        }
    }

    /* Diagnostic: write to dock-addon.log for production debugging.
       Format: one line per process, all key fields for cross-referencing. */
    const char *dataDir = getenv("ANIMUS_DATA_DIR");
    if (dataDir) {
        char logPath[1024];
        snprintf(logPath, sizeof(logPath), "%s/dock-addon.log", dataDir);
        FILE *f = fopen(logPath, "a");
        if (f) {
            const char *dyld = getenv("DYLD_INSERT_LIBRARIES");
            const char *opts = getenv("NODE_OPTIONS");
            extern char ***_NSGetArgv(void);
            const char *argv0 = (*_NSGetArgv())[0];

            fprintf(f, "dock_suppress: pid=%d ppid=%d ok=%d method=%s "
                       "initial=%s verified=%s readback=%s "
                       "dyld=%s opts=%s argv0=%s ts=%ld\n",
                    getpid(), getppid(), ok,
                    method,
                    (initial_policy >= 0) ? policy_name(initial_policy) : "no_app",
                    verified,
                    (readback_policy >= 0) ? policy_name(readback_policy) : "n/a",
                    dyld ? dyld : "unset",
                    opts ? opts : "unset",
                    argv0 ? argv0 : "unknown",
                    (long)time(NULL));
            fclose(f);
        }
    }
}

/* Minimal NAPI module registration so Node.js accepts the .node file.
   No headers required: napi_env and napi_value are opaque pointers,
   and the symbol is resolved by name at load time. */
__attribute__((visibility("default")))
void *napi_register_module_v1(void *env, void *exports) {
    return exports;
}
