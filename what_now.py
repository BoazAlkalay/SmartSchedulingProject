from datetime import datetime
import frontmatter
from vault_reader import read_tasks
from system_reader import load_runtime_context
from checkin import get_recent_checkins
from llm import ask
from config import INBOX, TASKS


def get_all_tasks():
    """
    read tasks from inbox and all task subfolders
    """
    tasks = []

    # read inbox
    tasks.extend(read_tasks("inbox"))

   # read tasks folder recursively
    for file in TASKS.rglob("*.md"):
        if file.is_file():
            post = frontmatter.load(file)
            # skip folder notes and done tasks
            if not post.metadata.get("title"):
                continue
            if post.metadata.get("status") == "done":
                continue
        
            tasks.append({
                "file": file.name,
                "metadata": post.metadata,
                "notes": post.content,
                "scheduling_instructions": post.metadata.get("scheduling_instructions", "")
            })
    return tasks

def format_tasks_for_prompt(tasks):
    """Format tasks into a readable string for the LLM prompt."""
    if not tasks:
        return "No tasks found."
    
    formatted = []
    for task in tasks:
        m = task["metadata"]
        
        # Skip done tasks
        if m.get("status") == "done":
            continue
            
        entry = f"""
- {m.get('title', task['file'])}
  status: {m.get('status', 'unknown')}
  priority: {m.get('priority', 'none')}
  energy: {m.get('energy_required', 'unknown')} (slot {m.get('slot_level', '?')})
  duration: {m.get('duration_estimated', 'unknown')}
  deadline: {m.get('deadline', 'none')}
  preferred days: {m.get('preferred_days', [])}
  blocked by: {m.get('blocked_by', [])}"""
        
        if task.get('scheduling_instructions'):
            entry += f"\n  scheduling notes: {task['scheduling_instructions']}"
            
        formatted.append(entry)
    
    return "\n".join(formatted)


def what_now(current_energy: str = None, slots_remaining: str = None):
    """
    Core function — given current context, suggest 2-3 tasks to do right now.
    """
    now = datetime.now()
    current_time = now.strftime("%I:%M %p")
    current_day = now.strftime("%A").lower()

    # load everything
    runtime = load_runtime_context()
    tasks = get_all_tasks()
    recent_checkins = get_recent_checkins(days=3)

    # format for prompt
    task_list = format_tasks_for_prompt(tasks)
    checkin_summary = "\n---\n".join(recent_checkins[-3:]) if recent_checkins else "No recent checkins"

    # build energy context
    energy_context = ""
    if current_energy:
        energy_context += f"Current energy level: {current_energy}\n"
    if slots_remaining:
        energy_context += f"Spell slots remaining today: {slots_remaining}\n"

    prompt = f"""
Current time: {current_time}
Current day: {current_day}
{energy_context}

Recent checkins:
{checkin_summary}

Available tasks:
{task_list}

Soft schedule preferences:
{runtime['soft_schedule']}

Based on all of the above, suggest 2-3 tasks this person could do right now.
Follow the scheduling rules in your instructions exactly.
Format your response like this:

Option 1 — [task name] ([duration])
Why: [one sentence reason]

Option 2 — [task name] ([duration])
Why: [one sentence reason]

Option 3 — [task name] ([duration]) 
Why: [one sentence reason]

Keep it short, scannable, and non-judgmental.
"""
    
    return ask(prompt)



if __name__ == "__main__":
    tasks = get_all_tasks()
    print(f"Found {len(tasks)} tasks:")
    for t in tasks:
        print(f" - {t['metadata'].get('title', t['file'])}")



    print("=== What Should I Do Now? ===\n")
    
    # Test without energy input first
    response = what_now()
    print(response)
    
    print("\n=== With Energy Context ===\n")
    
    # Test with energy and slots
    response = what_now(
        current_energy="high"
    )
    print(response)