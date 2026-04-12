import frontmatter
import re
from pathlib import Path
from config import TASKS, INBOX

def fix_title(title: str) -> str:
    """Convert underscore_title to Title Case With Spaces."""
    title = title.replace("_", " ")
    title = title.strip()
    title = title.title()
    return title

def migrate_titles():
    all_files = list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md"))
    fixed = 0

    for filepath in all_files:
        post = frontmatter.load(filepath)
        title = post.metadata.get("title", "")

        if not title:
            continue

        if "_" in title:
            new_title = fix_title(title)
            print(f"  {title} → {new_title}")
            post.metadata["title"] = new_title

            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(frontmatter.dumps(post))
            fixed += 1

    print(f"\nFixed {fixed} titles.")

if __name__ == "__main__":
    print("Fixing task titles...\n")
    migrate_titles()