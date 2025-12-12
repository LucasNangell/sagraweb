import os
import pymysql
import re
from database import db

# 1. Load CSS and Clean it
pts_dir = r"c:\Users\P_918713\Desktop\Antigravity\SagraWeb\PTs"
css_path = os.path.join(pts_dir, "style.css")

if os.path.exists(css_path):
    with open(css_path, "r", encoding="utf-8") as f:
        css_raw = f.read()
    
    # Remove existing <style> tags if present
    css_content = re.sub(r'<style[^>]*>', '', css_raw)
    css_content = re.sub(r'</style>', '', css_content)
    
    # Scope CSS (Simple regex approach, not perfect but sufficient for this specific CSS)
    # We want to prefix all rules with .pt-content
    # But we skip @media, @font-face etc if possible (assuming none for now based on snippet)
    # Removing 'body' selector and replacing with .pt-content
    css_content = css_content.replace('body {', '.pt-content {')
    
    # For other selectors, we might need a parser or just wrap it in a scoped way if browser supported...
    # Or just inject it as is but rely on classes.
    # The CSS uses .document-container, .doc-paragraph etc.
    # Changing 'body' to '.pt-content' is probably enough if the main container has that class.
    
else:
    css_content = ""

# 2. Iterate and Update
files = [f for f in os.listdir(pts_dir) if f.endswith(".html")]
count = 0

for filename in files:
    titulo = os.path.splitext(filename)[0]
    full_path = os.path.join(pts_dir, filename)
    
    with open(full_path, "r", encoding="utf-8") as f:
        html_raw = f.read()

    # Extract BODY content
    # Regex to find content between <body> and </body>
    body_match = re.search(r'<body[^>]*>(.*?)</body>', html_raw, re.DOTALL | re.IGNORECASE)
    if body_match:
        html_body = body_match.group(1)
    else:
        # Fallback if no body tag found
        html_body = html_raw
        
    # Clean up standard tags if they remain inside body (unlikely but safe)
    
    # Wrap in container
    final_html = f"""
<style>
{css_content}
</style>
<div class='pt-content document-container'>
{html_body}
</div>
"""
    
    # Update DB
    db.execute_query(
        "UPDATE tabProblemasPadrao SET ProbTecHTML = %s WHERE TituloPT = %s",
        (final_html, titulo)
    )
    count += 1
    print(f"Updated: {titulo}")

print(f"Update Finished. {count} items updated.")
