-- Rename 'xhigh' thinking level to 'max' (align with Cortex public API)
-- and change default from 'off' to 'high'
UPDATE system_settings SET cortex_thinking_level = 'max' WHERE cortex_thinking_level = 'xhigh';
UPDATE system_settings SET cortex_thinking_level = 'high' WHERE cortex_thinking_level = 'off';
