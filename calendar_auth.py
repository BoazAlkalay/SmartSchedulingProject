import os
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from pathlib import Path

# Scopes we need
SCOPES = ['https://www.googleapis.com/auth/calendar.readonly',
          'https://www.googleapis.com/auth/calendar.events']

# Token files — one per account
PERSONAL_TOKEN = Path("token_personal.json")
SCHOOL_TOKEN = Path("token_school.json")
CREDENTIALS_FILE = Path("credentials.json")


def get_calendar_service(token_file: Path) -> object:
    """
    Authenticate and return a Google Calendar service object.
    Handles token refresh automatically.
    """
    creds = None

    # Load existing token if it exists
    if token_file.exists():
        creds = Credentials.from_authorized_user_file(
            str(token_file), SCOPES
        )

    # if no valid credentials then authenticate
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                str(CREDENTIALS_FILE), SCOPES
            )
            creds = flow.run_local_server(port=0)

        # saves token for next time
        with open(token_file, 'w') as f:
            f.write(creds.to_json())

    return build('calendar', 'v3', credentials=creds)

def get_personal_service():
    """ get calendar service for personal google account """
    return get_calendar_service(PERSONAL_TOKEN)

def get_school_service():
    """ get calendar service for school google account """
    return get_calendar_service(SCHOOL_TOKEN)

if __name__ == "__main__":
    print("Authenticating personal Google account...")
    personal = get_personal_service()
    print("Personal account connected.")
    
    print("\nAuthenticating school Google account...")
    school = get_school_service()
    print("School account connected.")
    
    print("\nBoth accounts authenticated successfully.")