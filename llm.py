import os
import ollama
import anthropic
from system_reader import load_runtime_context
from config import RUNTIME_MODEL, REFINEMENT_MODEL

# Anthropic client as fallback
anthropic_client = anthropic.Anthropic(
    api_key=os.environ.get("ANTHROPIC_API_KEY")
)

def ask_ollama(prompt: str, system_prompt: str = "") -> str:
    messages = []
    
    if system_prompt:
        # Keep system prompt lean for local model
        messages.append({
            "role": "system",
            "content": system_prompt[:1500]  # trim if too long
        })
    
    messages.append({
        "role": "user",
        "content": prompt
    })
    
    response = ollama.chat(
        model="mistral",
        messages=messages
    )
    
    return response["message"]["content"]

def ask_anthropic(prompt: str, system_prompt: str = "") -> str:
    """
    Send a message to Anthropic API as fallback.
    """
    message = anthropic_client.messages.create(
        model=RUNTIME_MODEL,
        max_tokens=1024,
        system=system_prompt,
        messages=[
            {"role": "user", "content": prompt}
        ]
    )
    return message.content[0].text

def ask(user_message: str, include_system: bool = True, use_local: bool = True) -> str:
    """
    Send a message to the LLM.
    Tries Ollama first, falls back to Anthropic if it fails.
    """
    system_prompt = ""
    
    if include_system:
        runtime = load_runtime_context()
        system_prompt = f"""You are a personal scheduling assistant.
You know the following about how this person works:

{runtime['core']}

Current context:
{runtime['context']}

Soft schedule preferences:
{runtime['soft_schedule']}

Always follow these instructions when responding."""

    if use_local:
        try:
            return ask_ollama(user_message, system_prompt)
        except Exception as e:
            print(f"Ollama failed: {e}")
            print("Falling back to Anthropic API...")
            return ask_anthropic(user_message, system_prompt)
    else:
        return ask_anthropic(user_message, system_prompt)

if __name__ == "__main__":
    print("Testing Ollama connection...\n")
    response = ask(
        "I have 45 minutes free right now. What should I do?",
        use_local=True
    )
    print(response)