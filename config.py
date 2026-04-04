from pathlib import Path
import os


# Detect which machine we're on by username
username = os.getlogin()

if username == "boaz_":  # desktop username
    VAULT_PATH = Path("C:/Obsidian Vault Location/SmartScheduler")
elif username == "boaza":  # laptop username
    VAULT_PATH = Path("C:/Obsidian Vaults/SmartScheduler")
else:
    raise ValueError(f"Unknown machine: {username}. Add your vault path to config.py")
# Vault location — update this when moving to desktop
VAULT_PATH = Path("C:/Obsidian Vaults/SmartScheduler")

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