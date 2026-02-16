# Tasks, Contacts & Forms — Full Reference

## Google Tasks

### Task Lists

```bash
gog tasks lists --json                    # List all task lists
gog tasks lists --max 50 --json
gog tasks lists create "Shopping List"    # Create new list
```

### Tasks

```bash
# List tasks
gog tasks list <tasklistId> --max 50 --json

# Get single task
gog tasks get <tasklistId> <taskId> --json

# Create tasks
gog tasks add <tasklistId> --title "Buy groceries"
gog tasks add <tasklistId> --title "Call dentist" --due 2025-02-15

# Recurring tasks
gog tasks add <tasklistId> --title "Weekly sync" --due 2025-02-01 --repeat weekly --repeat-count 4
gog tasks add <tasklistId> --title "Daily standup" --due 2025-02-01 --repeat daily --repeat-until 2025-02-05

# Update
gog tasks update <tasklistId> <taskId> --title "Updated title"

# Complete / uncomplete
gog tasks done <tasklistId> <taskId>
gog tasks undo <tasklistId> <taskId>

# Delete
gog tasks delete <tasklistId> <taskId>

# Clear completed tasks from a list
gog tasks clear <tasklistId>
```

---

## Contacts

### Searching & Listing

```bash
gog contacts list --max 50 --json
gog contacts search "Alice" --max 10 --json

# Get specific contact
gog contacts get people/<resourceName> --json
gog contacts get user@example.com --json

# "Other contacts" (auto-saved from interactions)
gog contacts other list --max 50 --json
gog contacts other search "John" --max 50 --json
```

### Creating

```bash
gog contacts create --given "John" --family "Doe" --email "john@example.com" --phone "+1234567890"
```

### Updating

```bash
gog contacts update people/<resourceName> --given "Jane" --email "jane@example.com"
gog contacts update people/<resourceName> --birthday "1990-05-12" --notes "Met at WWDC"

# Update from JSON via stdin
echo '{"names":[{"givenName":"Updated"}]}' | gog contacts update people/<resourceName> --from-file -
```

### Deleting

```bash
gog contacts delete people/<resourceName>
```

### Directory (Google Workspace)

```bash
gog contacts directory list --max 50 --json
gog contacts directory search "Jane" --max 50 --json
```

---

## Google Forms

```bash
# Get form structure
gog forms get <formId> --json

# Create form
gog forms create --title "Weekly Check-in" --description "Friday async update"

# List responses
gog forms responses list <formId> --max 20 --json

# Get specific response
gog forms responses get <formId> <responseId> --json
```

---

## Google People API

```bash
# Current user profile
gog people me --json

# Get someone's profile
gog people get people/<userId> --json

# Search people
gog people search "Ada Lovelace" --max 5 --json

# Org relationships
gog people relations --json
gog people relations people/<userId> --type manager --json
```
