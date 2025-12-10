import requests
import json

def check_api():
    try:
        url = "http://localhost:8000/api/aux/formatos"
        print(f"Calling {url}...")
        res = requests.get(url)
        print(f"Status: {res.status_code}")
        if res.status_code == 200:
            data = res.json()
            print(f"Received {len(data)} items")
            print(json.dumps(data[:5], indent=2))
        else:
            print("Failed")
            print(res.text)
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_api()
