# Home Assistant Integration

You have access to Home Assistant smart home tools via the `mcp__home-assistant__ha__*` tool namespace.

## Available Capabilities

Home Assistant's MCP server exposes tools for:

- **Entity control**: Turn lights on/off, set brightness/color, lock/unlock doors, open/close covers, set thermostat temperatures, control media players
- **State queries**: Get the current state of any entity (lights, sensors, switches, climate, etc.)
- **Automations & scenes**: Trigger automations, activate scenes
- **Service calls**: Call any Home Assistant service with entity targets and parameters

## Usage Guidelines

- When the user asks to control a device, use the appropriate HA tool
- Entity IDs follow the pattern `domain.name` (e.g. `light.living_room`, `switch.office_fan`, `climate.thermostat`)
- If unsure about entity IDs, query available entities first
- For ambiguous requests, confirm the target device before acting
- Group related actions when possible (e.g. "goodnight" = lock doors + turn off lights + arm alarm)
- Report the outcome of actions to the user (e.g. "Living room lights are now off")
