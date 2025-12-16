import urllib.request
import json

# Test /api/aux/setores
try:
    response = urllib.request.urlopen('http://localhost:8001/api/aux/setores')
    data = json.loads(response.read())
    print("✅ /api/aux/setores:", data)
except Exception as e:
    print("❌ /api/aux/setores:", e)

# Test /api/aux/andamentos
try:
    response = urllib.request.urlopen('http://localhost:8001/api/aux/andamentos')
    data = json.loads(response.read())
    print("✅ /api/aux/andamentos:", data)
except Exception as e:
    print("❌ /api/aux/andamentos:", e)
