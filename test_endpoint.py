#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Test the /gravacao/xpose/status endpoint"""

import requests
import json

API_BASE_URL = "http://localhost:8001/api"
ENDPOINT = f"{API_BASE_URL}/gravacao/xpose/status"

print("=" * 50)
print(f"Testing endpoint: {ENDPOINT}")
print("=" * 50)

try:
    response = requests.get(ENDPOINT, timeout=5)
    print(f"\nStatus Code: {response.status_code}")
    
    if response.ok:
        data = response.json()
        print(f"\nTickets returned: {len(data.get('tickets', []))}")
        print(f"Paths returned: {len(data.get('paths', []))}")
        print(f"Errors: {data.get('meta', {}).get('errors', [])}")
        
        # Show sample tickets
        tickets = data.get('tickets', [])
        if tickets:
            print("\nSample tickets with Printing status:")
            printing_tickets = [t for t in tickets if 'printing' in (t.get('status', '') or '').lower()]
            if printing_tickets:
                for t in printing_tickets[:3]:
                    print(f"  - {t['name']}: {t.get('status')}")
            else:
                print("  No tickets with Printing status found")
            
            print("\nAll status values found:")
            statuses = set(t.get('status') for t in tickets)
            for s in sorted(statuses):
                print(f"  - {s}")
    else:
        print(f"Error: {response.text}")
        
except requests.exceptions.ConnectionError:
    print("Error: Cannot connect to API. Make sure the server is running on port 8001")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 50)
