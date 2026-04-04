import frontmatter
from pathlib import Path
from config import VAULT_PATH, INBOX


def read_tasks(folder="inbox"):
    task_folder = VAULT_PATH / folder
    tasks = []

    for file in task_folder.glob("*.md"):
        post = frontmatter.load(file)
        tasks.append({
            "file": file.name,
            "metadata": post.metadata,
            "notes": post.content
        })
    
    return tasks

if __name__ == "__main__":
    tasks = read_tasks("inbox")
    for task in tasks:
        print(f"\nFile: {task['file']}")
        print(f"Title: {task['metadata'].get('title', 'untitled')}")
        print(f"Priority: {task['metadata'].get('priority', 'none')}")
        print(f"Status: {task['metadata'].get('status', 'none')}")
        print(f"Energy: {task['metadata'].get('energy_required', 'none')}")