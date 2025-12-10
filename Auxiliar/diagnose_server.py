import requests
import sys

def check():
    try:
        url = "http://localhost:8000/api/aux/produtos"
        print(f"Checking {url}...")
        resp = requests.get(url, timeout=5)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            print("Response Sample:", resp.json()[:3])
            print("OK.")
        else:
            print("Error: Server returned non-200")
            print(resp.text)
    except Exception as e:
        print(f"EXCEPTION: {e}")

if __name__ == "__main__":
    check()
