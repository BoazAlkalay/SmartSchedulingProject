import os
import anthropic
from system_reader import load_runtime_context
from config import RUNTIME_MODEL


client = anthropic.Anthropic(
    api_key=os.environ.get("ANTHROPIC_API_KEY")
)

def ask(user_message: str, include_system: bool = True) -> str:
    """
    Send a message to Claude and return the response.
    Optionally includes your core instructions and context.
    """
    system_prompt = ""

    if include_system:
        runtime = load_runtime_context()
        system_prompt = f"""You are a personal scheduling assistant. 
You know the following about how this person works:

{runtime['core']}

Current context:
{runtime['context']}

Always follow these instructions when responding."""

    message = client.messages.create(
        model=RUNTIME_MODEL,
        max_tokens=1024,
        system=system_prompt,
        messages=[
            {"role": "user", "content": user_message}
        ]
    )
    
    return message.content[0].text

if __name__ == "__main__":
    print("Testing LLM connection...\n")
    
    response = ask(
        "In one sentence, what do you know about how I prefer to schedule my day?"
    )
    
    print(response)