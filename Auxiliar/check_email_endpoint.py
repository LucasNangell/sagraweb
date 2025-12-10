try:
    from server import fetch_outlook_emails
    print("Function imported successfully.")
    
    data = fetch_outlook_emails()
    print(f"Data fetched: {len(data)} items.")
    print("Success.")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
