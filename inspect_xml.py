
import xml.etree.ElementTree as ET
import re
import os

file_path = r"I:\Apogee_Files\3- PrintQ\PrintQ Jobs\Tickets.Xml"
ticket_name_target = "2025_OS 02480-SM-FrancianeBayer-Livro_Eca"

if not os.path.exists(file_path):
    print(f"File not found: {file_path}")
    exit()

try:
    with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
        # Remove namespaces
        content = re.sub(r' xmlns="[^"]+"', '', content, count=1)
        root = ET.fromstring(content)
        
        found = False
        for ticket in root.findall(".//XPoseTicket"):
            name = ticket.find("Name").text if ticket.find("Name") is not None else "-"
            
            if name == ticket_name_target:
                found = True
                status = ticket.find("Status").text
                print(f"Ticket: {name}")
                print(f"Status: {status}")
                
                paths = ticket.findall("Path")
                print(f"Paths count: {len(paths)}")
                for p in paths:
                    p_name = p.find("Name").text
                    p_status = p.find("Status").text
                    print(f"  Path: {p_name} | Status: {p_status}")
                    
        if not found:
            print("Ticket not found in XML")

except Exception as e:
    print(f"Error: {e}")
