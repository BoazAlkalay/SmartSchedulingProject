import os
import re
import anthropic
from datetime import datetime
from pathlib import Path
from system_reader import load_refinement_context
from config import VAULT_PATH, REFINEMENT_MODEL

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

PENDING_CHANGES = VAULT_PATH / "system/pending_changes.md"


def propose_refinements() -> str:
    """
    Load all system files, ask the LLM to propose changes,
    write them to pending_changes.md for review.
    """
    context = load_refinement_context()

    prompt = f"""You are reviewing a personal scheduling assistant's core instructions.
Your job is to propose specific, grounded updates based on the user's observations and complaints.

Current core instructions:
{context['core']}

User preferences:
{context['preferences']}

Observations:
{context['observations']}

Complaints:
{context['complaints']}

Current context:
{context['context']}

Propose ONLY changes that are clearly supported by the observations or complaints.
Do not speculate. Do not restructure the document.
You may propose additions of new rules if they are grounded in evidence.

Return ONLY a list of changes in exactly this format, no preamble:

### Change 1
SECTION: [section name from the document]
CURRENT: [exact current text, or NEW if adding]
NEW: [proposed replacement text]
REASON: [one sentence citing specific evidence from observations/complaints]

### Change 2
...

If no changes are warranted, return exactly: NO CHANGES NEEDED"""

    message = client.messages.create(
        model=REFINEMENT_MODEL,
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )

    response = message.content[0].text.strip()

    if response == "NO CHANGES NEEDED":
        return "No changes proposed. Your system is up to date."

    # Write to pending_changes.md
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    content = f"# Pending Changes — {now}\n\nReview and delete any changes you don't want, then run Apply Refinements.\n\n{response}\n"

    with open(PENDING_CHANGES, "w", encoding="utf-8") as f:
        f.write(content)

    # Count proposed changes
    change_count = response.count("### Change")
    return f"{change_count} changes proposed. Review pending_changes.md in Obsidian, then run Apply Refinements."


def apply_refinements() -> str:
    """
    Read pending_changes.md, apply each change to core_instructions.md,
    save a versioned backup, then clear pending_changes.md.
    """
    if not PENDING_CHANGES.exists():
        return "No pending changes file found. Run Propose Refinements first."

    with open(PENDING_CHANGES, "r", encoding="utf-8") as f:
        pending = f.read()

    # Parse individual changes
    changes = re.split(r"### Change \d+", pending)
    changes = [c.strip() for c in changes if c.strip() and "SECTION:" in c]

    if not changes:
        return "No changes found in pending_changes.md."

    # Load current core instructions
    from config import CORE_INSTRUCTIONS

    with open(CORE_INSTRUCTIONS, "r", encoding="utf-8") as f:
        core = f.read()

    # Save versioned backup
    history_dir = VAULT_PATH / "system/history"
    history_dir.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d-%H%M")
    backup_path = history_dir / f"core_instructions_{timestamp}.md"
    with open(backup_path, "w", encoding="utf-8") as f:
        f.write(core)
    print(f"Backup saved: {backup_path.name}")

    # Apply each change
    applied = 0
    skipped = 0

    for change in changes:
        # Parse fields
        section_match = re.search(r"SECTION:\s*(.+)", change)
        current_match = re.search(r"CURRENT:\s*(.+)", change)
        new_match = re.search(r"NEW:\s*(.+)", change)
        reason_match = re.search(r"REASON:\s*(.+)", change)

        if not all([section_match, current_match, new_match]):
            skipped += 1
            continue

        current_text = current_match.group(1).strip()
        new_text = new_match.group(1).strip()
        reason = reason_match.group(1).strip() if reason_match else ""

        if current_text.upper() == "NEW":
            # Adding a new rule — append to the relevant section
            section = section_match.group(1).strip()
            if section in core:
                # Find section and append after it
                core = core.replace(f"{section}\n", f"{section}\n* {new_text}\n")
                print(f"Added: {new_text}")
                applied += 1
            else:
                print(f"Section not found: {section}, skipping.")
                skipped += 1
        else:
            # Replacing existing text
            if current_text in core:
                core = core.replace(current_text, new_text)
                print(f"Applied: {current_text} → {new_text}")
                applied += 1
            else:
                print(f"Could not find: {current_text}, skipping.")
                skipped += 1

    # Write updated core instructions
    with open(CORE_INSTRUCTIONS, "w", encoding="utf-8") as f:
        f.write(core)

    # Clear pending changes
    with open(PENDING_CHANGES, "w", encoding="utf-8") as f:
        f.write("# Pending Changes\n\nNo pending changes.\n")

    return f"Applied {applied} changes, skipped {skipped}. Backup saved as {backup_path.name}."


def reinitialize_core() -> str:
    """
    Rebuild core_instructions.md from scratch using all system files.
    Saves a versioned backup first.
    """
    context = load_refinement_context()

    prompt = f"""You are rebuilding a personal scheduling assistant's core instructions from scratch.
Based on all the information below, generate a clean, coherent, well-structured core_instructions.md.

User preferences:
{context['preferences']}

Observations:
{context['observations']}

Complaints:
{context['complaints']}

Current context:
{context['context']}

Soft schedule:
{context['soft_schedule']}

Current core instructions (for reference only, do not copy blindly):
{context['core']}

Rules for the new document:
- Keep the same section structure: Task Categories, Classification Rules, Capacity, Slot Level Mapping, Folder vs Energy Level, Scheduling Rules, Avoidance Handling, Delivery, Current Context
- Incorporate any patterns or preferences evident in observations and complaints
- Remove anything contradicted by observations
- Keep language concise and instructional
- Do not add speculation
- Add a generated timestamp and version number at the top

Return ONLY the new markdown document, no preamble."""

    message = client.messages.create(
        model=REFINEMENT_MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    new_core = message.content[0].text.strip()

    # Save versioned backup
    from config import CORE_INSTRUCTIONS

    history_dir = VAULT_PATH / "system/history"
    history_dir.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d-%H%M")
    backup_path = history_dir / f"core_instructions_{timestamp}.md"

    with open(CORE_INSTRUCTIONS, "r", encoding="utf-8") as f:
        old_core = f.read()
    with open(backup_path, "w", encoding="utf-8") as f:
        f.write(old_core)

    # Write new core instructions
    with open(CORE_INSTRUCTIONS, "w", encoding="utf-8") as f:
        f.write(new_core)

    return f"Core instructions rebuilt. Backup saved as {backup_path.name}."


def consolidate_ideas() -> str:
    """
    Read ideas.md, consolidate and prioritize into a structured roadmap.md.
    """
    from config import VAULT_PATH

    ideas_path = VAULT_PATH / "system/ideas.md"
    roadmap_path = VAULT_PATH / "system/roadmap.md"

    if not ideas_path.exists():
        return "No ideas.md found."

    with open(ideas_path, "r", encoding="utf-8") as f:
        ideas = f.read()

    if not ideas.strip():
        return "ideas.md is empty."

    prompt = f"""You are reviewing a list of ideas, feature requests, and improvements for a personal scheduling assistant called SmartScheduler.

Your job is to consolidate these ideas into a structured, prioritized roadmap.

Raw ideas:
{ideas}

Instructions:
- Group related ideas together under themes
- Remove exact duplicates, merge near-duplicates
- Estimate complexity for each: Quick (< 1hr), Medium (1-3hrs), Large (3hrs+)
- Prioritize within each group: High / Medium / Low
- Note any dependencies between features

Return ONLY a markdown document in exactly this structure:

# SmartScheduler Roadmap
Generated: {datetime.now().strftime("%Y-%m-%d %H:%M")}

## Quick Wins
<!-- High value, low effort -->
- [ ] **Idea title** (Priority: High) — brief description. Complexity: Quick

## Core Features
<!-- Important for daily use -->
- [ ] **Idea title** (Priority: High) — brief description. Complexity: Medium

## Future Enhancements
<!-- Nice to have, lower urgency -->
- [ ] **Idea title** (Priority: Low) — brief description. Complexity: Large

## Dependencies & Notes
<!-- Any important relationships between features -->
- Note about dependencies

No preamble, no explanation, just the markdown document."""

    message = client.messages.create(
        model=REFINEMENT_MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    roadmap = message.content[0].text.strip()

    with open(roadmap_path, "w", encoding="utf-8") as f:
        f.write(roadmap)

    return f"Roadmap generated and saved to system/roadmap.md. Open it in Obsidian to review."


if __name__ == "__main__":
    print(propose_refinements())
