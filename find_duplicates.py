import frontmatter
from pathlib import Path
from config import TASKS, INBOX

def find_duplicates():
    all_files = list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md"))
    
    # Build a dict of title -> list of filepaths
    title_map = {}
    for filepath in all_files:
        post = frontmatter.load(filepath)
        title = post.metadata.get("title", "")
        if not title:
            continue
        title_lower = title.lower()
        if title_lower not in title_map:
            title_map[title_lower] = []
        title_map[title_lower].append((title, filepath))
    
    # Filter to only duplicates
    duplicates = {t: files for t, files in title_map.items() if len(files) > 1}
    
    if not duplicates:
        print("No duplicates found.")
        return
    
    for title_lower, files in duplicates.items():
        print(f"\nDuplicate: '{files[0][0]}'")
        for i, (title, filepath) in enumerate(files, 1):
            print(f"  {i}. {filepath.parent.name} / {filepath.name}")
        
        choice = input("Keep which? (enter number, 'both' to skip, 'quit' to exit): ").strip().lower()
        
        if choice == "quit":
            break
        elif choice == "both":
            continue
        elif choice.isdigit():
            keep_idx = int(choice) - 1
            for i, (title, filepath) in enumerate(files):
                if i != keep_idx:
                    filepath.unlink()
                    print(f"  Deleted: {filepath.name}")
            print(f"  Kept: {files[keep_idx][1].name}")
        else:
            print("  Invalid input, skipping.")

if __name__ == "__main__":
    print("Scanning for duplicate tasks...\n")
    find_duplicates()