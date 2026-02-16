# Calendar — Full Reference

## Viewing Events

```bash
# Time-based queries
gog calendar events primary --today --json
gog calendar events primary --tomorrow --json
gog calendar events primary --week --json
gog calendar events primary --week --week-start --json   # Start from Monday
gog calendar events primary --days 3 --json
gog calendar events primary --from today --to friday --json
gog calendar events primary --from today --to friday --weekday --json   # Exclude weekends
gog calendar events primary --from 2025-01-01T00:00:00Z --to 2025-01-08T00:00:00Z --json

# All calendars at once
gog calendar events --all --today --json

# Single event
gog calendar event primary <eventId> --json
gog calendar get primary <eventId> --json
```

## Searching Events

```bash
gog calendar search "meeting" --today --json
gog calendar search "standup" --tomorrow --json
gog calendar search "review" --days 365 --json
gog calendar search "offsite" --from 2025-01-01T00:00:00Z --to 2025-12-31T00:00:00Z --max 50 --json
```

## Creating Events

```bash
# Simple event
gog calendar create primary --summary "Meeting" --from 2025-01-15T10:00:00Z --to 2025-01-15T11:00:00Z

# With attendees and location
gog calendar create primary --summary "Team Sync" \
  --from 2025-01-15T14:00:00Z --to 2025-01-15T15:00:00Z \
  --attendees "alice@example.com,bob@example.com" \
  --location "Zoom" \
  --send-updates all

# Recurring event
gog calendar create primary --summary "Payment" \
  --from 2025-02-11T09:00:00-03:00 --to 2025-02-11T09:15:00-03:00 \
  --rrule "RRULE:FREQ=MONTHLY;BYMONTHDAY=11" \
  --reminder "email:3d" --reminder "popup:30m"

# All-day event
gog calendar create primary --summary "Vacation" --from 2025-01-20 --to 2025-01-21 --all-day

# Special event types
gog calendar create primary --event-type focus-time --from 2025-01-15T13:00:00Z --to 2025-01-15T14:00:00Z
gog calendar create primary --event-type out-of-office --from 2025-01-20 --to 2025-01-21 --all-day
gog calendar create primary --event-type working-location --working-location-type office --working-office-label "HQ" --from 2025-01-22 --to 2025-01-23

# Shorthand for special types
gog calendar focus-time --from 2025-01-15T13:00:00Z --to 2025-01-15T14:00:00Z
gog calendar out-of-office --from 2025-01-20 --to 2025-01-21 --all-day
gog calendar working-location --type office --office-label "HQ" --from 2025-01-22 --to 2025-01-23
```

## Updating Events

```bash
gog calendar update primary <eventId> --summary "Updated Meeting"
gog calendar update primary <eventId> --from 2025-01-15T11:00:00Z --to 2025-01-15T12:00:00Z
gog calendar update primary <eventId> --add-attendee "alice@example.com,bob@example.com"
gog calendar update primary <eventId> --send-updates externalOnly
```

## Deleting Events

```bash
gog calendar delete primary <eventId>
gog calendar delete primary <eventId> --force                    # Skip confirmation
gog calendar delete primary <eventId> --send-updates all --force # Notify attendees
```

## Responding to Invitations

```bash
gog calendar respond primary <eventId> --status accepted
gog calendar respond primary <eventId> --status declined
gog calendar respond primary <eventId> --status tentative
gog calendar respond primary <eventId> --status declined --send-updates externalOnly
```

## Proposing New Times

```bash
gog calendar propose-time primary <eventId>                        # Interactive
gog calendar propose-time primary <eventId> --open                 # Open in browser
gog calendar propose-time primary <eventId> --decline --comment "Can we do 5pm?"
```

## Free/Busy & Conflicts

```bash
# Check free/busy status
gog calendar freebusy --calendars "primary,work@example.com" \
  --from 2025-01-15T00:00:00Z --to 2025-01-16T00:00:00Z --json

# Find scheduling conflicts
gog calendar conflicts --calendars "primary,work@example.com" --today --json
```

## Team Calendars

```bash
gog calendar team engineering@company.com --today --json
gog calendar team engineering@company.com --week --json
gog calendar team engineering@company.com --freebusy --json
gog calendar team engineering@company.com --query "standup" --json
```

## Calendar Management

```bash
gog calendar calendars --json       # List all calendars
gog calendar acl <calendarId> --json  # Access control list
gog calendar colors --json           # Available color IDs
gog calendar users --json            # Calendar users
```

## Time

```bash
gog time now --json
gog time now --timezone UTC --json
gog time now --timezone America/New_York --json
gog calendar time --timezone America/New_York   # Set display timezone
```
