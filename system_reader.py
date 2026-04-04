import frontmatter
from pathlib import Path
from config import (
    CORE_INSTRUCTIONS,
    PREFERENCES,
    CONTEXT,
    OBSERVATIONS,
    COMPLAINTS,
    SOFT_SCHEDULE
)

def read_system_file(filepath):
    """
    Read a plain markdown file and return its content as a string.
    """
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        print(f"Warning: {filepath} not found")
        return ""
    
def load_runtime_context():
    """
    Load only what's needed for runtime decisions.
    Keeps the LLM prompt lean and focused.
    """
    return {
        "core": read_system_file(CORE_INSTRUCTIONS),
        "context": read_system_file(CONTEXT),
        "soft_schedule": read_system_file(SOFT_SCHEDULE)
    }

def load_refinement_context():
    """
    Load everything needed for a refinement run.
    Bigger context, only used occasionally.
    """
    return {
        "core": read_system_file(CORE_INSTRUCTIONS),
        "preferences": read_system_file(PREFERENCES),
        "observations": read_system_file(OBSERVATIONS),
        "complaints": read_system_file(COMPLAINTS),
        "context": read_system_file(CONTEXT),
        "soft_schedule": read_system_file(SOFT_SCHEDULE)
    }

if __name__ == "__main__":
    print("--- Testing runtime context ---")
    runtime = load_refinement_context()
    for key, value in runtime.items():
        print(f"\n[{key}]")
        print(value[:200]) # just first 200 ch to see if it loads