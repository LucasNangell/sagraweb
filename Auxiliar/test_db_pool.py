import threading
import time
from database import db
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(threadName)s: %(message)s')

def worker(i):
    try:
        logging.info(f"Worker {i} starting")
        # Simulate a query
        results = db.execute_query("SELECT 1")
        logging.info(f"Worker {i} got result: {results}")
        time.sleep(0.5) # Simulate work
        logging.info(f"Worker {i} finished")
    except Exception as e:
        logging.error(f"Worker {i} failed: {e}")

threads = []
for i in range(20): # More than max_connections (10)
    t = threading.Thread(target=worker, args=(i,))
    threads.append(t)
    t.start()

for t in threads:
    t.join()

print("Test complete")
