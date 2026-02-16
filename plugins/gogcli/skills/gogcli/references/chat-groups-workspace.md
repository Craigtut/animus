# Chat, Groups, Classroom & Apps Script — Full Reference

## Google Chat (Workspace)

### Spaces

```bash
gog chat spaces list --json
gog chat spaces find "Engineering" --json
gog chat spaces create "Engineering" --member alice@company.com --member bob@company.com
```

### Messages

```bash
# List messages in a space
gog chat messages list spaces/<spaceId> --max 10 --json
gog chat messages list spaces/<spaceId> --unread --json

# List messages in a thread
gog chat messages list spaces/<spaceId> --thread <threadId> --json

# Send message
gog chat messages send spaces/<spaceId> --text "Build complete!"

# Reply to thread
gog chat messages send spaces/<spaceId> --text "Reply" --thread spaces/<spaceId>/threads/<threadId>
```

### Direct Messages

```bash
# Find/create DM space with someone
gog chat dm space user@company.com --json

# Send DM
gog chat dm send user@company.com --text "Hey!"
```

### Threads

```bash
gog chat threads list spaces/<spaceId> --json
```

---

## Google Groups (Workspace)

```bash
gog groups list --json
gog groups members engineering@company.com --json
```

---

## Google Classroom (Workspace for Education)

### Courses

```bash
gog classroom courses list --json
gog classroom courses list --role teacher --json
gog classroom courses get <courseId> --json
gog classroom courses create --name "Math 101"
gog classroom courses update <courseId> --name "Math 102"
gog classroom courses archive <courseId>
gog classroom courses unarchive <courseId>
gog classroom courses url <courseId>
```

### Roster

```bash
gog classroom roster <courseId> --json
gog classroom roster <courseId> --students --json
gog classroom students add <courseId> <userId>
gog classroom teachers add <courseId> <userId>
```

### Coursework

```bash
gog classroom coursework list <courseId> --json
gog classroom coursework get <courseId> <courseworkId> --json
gog classroom coursework create <courseId> --title "Homework 1" --type ASSIGNMENT --state PUBLISHED
gog classroom coursework update <courseId> <courseworkId> --title "Updated"
gog classroom coursework assignees <courseId> <courseworkId> --mode INDIVIDUAL_STUDENTS --add-student <studentId>
```

### Materials

```bash
gog classroom materials list <courseId> --json
gog classroom materials create <courseId> --title "Syllabus" --state PUBLISHED
```

### Submissions & Grading

```bash
gog classroom submissions list <courseId> <courseworkId> --json
gog classroom submissions get <courseId> <courseworkId> <submissionId> --json
gog classroom submissions grade <courseId> <courseworkId> <submissionId> --grade 85
gog classroom submissions return <courseId> <courseworkId> <submissionId>
gog classroom submissions turn-in <courseId> <courseworkId> <submissionId>
gog classroom submissions reclaim <courseId> <courseworkId> <submissionId>
```

### Announcements

```bash
gog classroom announcements list <courseId> --json
gog classroom announcements create <courseId> --text "Welcome to class!"
gog classroom announcements update <courseId> <announcementId> --text "Updated"
```

### Topics

```bash
gog classroom topics list <courseId> --json
gog classroom topics create <courseId> --name "Unit 1"
gog classroom topics update <courseId> <topicId> --name "Unit 2"
```

### Invitations & Guardians

```bash
gog classroom invitations list --json
gog classroom invitations create <courseId> <userId> --role student
gog classroom invitations accept <invitationId>

gog classroom guardians list <studentId> --json
gog classroom guardian-invitations list <studentId> --json
gog classroom guardian-invitations create <studentId> --email parent@example.com
```

### Profiles

```bash
gog classroom profile get --json
gog classroom profile get <userId> --json
```

---

## Apps Script

```bash
# Get project info
gog appscript get <scriptId> --json

# Get source code
gog appscript content <scriptId> --json

# Create new project
gog appscript create --title "Automation Helpers"
gog appscript create --title "Bound Script" --parent-id <driveFileId>

# Execute a function
gog appscript run <scriptId> myFunction
gog appscript run <scriptId> myFunction --params '["arg1", 123, true]'
gog appscript run <scriptId> myFunction --dev-mode
```

---

## Google Keep (Workspace + Service Account only)

```bash
gog keep list --account you@yourdomain.com --json
gog keep get <noteId> --json
gog keep search "shopping" --json
gog keep attachment <attachmentName> --out ./attachment.bin
```

Note: Keep API requires a service account with domain-wide delegation.

---

## Configuration

```bash
gog config path                         # Show config file location
gog config list --json                  # List all config values
gog config keys                         # List available config keys
gog config get default_timezone         # Get specific value
gog config set default_timezone UTC     # Set value
gog config unset default_timezone       # Remove value
```
