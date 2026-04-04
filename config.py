from pathlib import Path


# Vault location — update this when moving to desktop
VAULT_PATH = Path("C:\Obsidian Vault Location\MySmartScheduler")

# System file paths
CORE_INSTRUCTIONS = VAULT_PATH / "system/core_instructions.md"
PREFERENCES = VAULT_PATH / "system/preferences.md"
CONTEXT = VAULT_PATH / "system/context.md"
OBSERVATIONS = VAULT_PATH / "system/observations.md"
COMPLAINTS = VAULT_PATH / "system/complaints.md"
SOFT_SCHEDULE = VAULT_PATH / "system/soft_schedule.md" 

# Task folders
INBOX = VAULT_PATH / "inbox"
TASKS = VAULT_PATH / "tasks"
SCHEDULED = VAULT_PATH / "scheduled"
DONE = VAULT_PATH / "done"
CHECKINS = VAULT_PATH / "checkins"

# Task sub-folders
## personal
PERSONAL = TASKS / "personal"
PROJECTS = PERSONAL / "projects"
HEALTH = PERSONAL / "health"
ERRANDS = PERSONAL / "errands"
HOUSEWORK = PERSONAL / "housework"
### D&D
DND = PERSONAL / "dnd"


# LLM Models
RUNTIME_MODEL = "claude-haiku-4-5-20251001"
REFINEMENT_MODEL = "claude-sonnet-4-6"