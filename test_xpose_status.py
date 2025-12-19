#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Test script to verify xpose_tickets and xpose_paths data"""

from database import db

print("=" * 50)
print("Testing xpose_tickets and xpose_paths tables")
print("=" * 50)

try:
    # Check tickets count
    tickets = db.execute_query('SELECT COUNT(*) as cnt FROM xpose_tickets')
    ticket_count = tickets[0]['cnt'] if tickets else 0
    print(f"\nTickets na base: {ticket_count}")

    # Check paths count
    paths = db.execute_query('SELECT COUNT(*) as cnt FROM xpose_paths')
    path_count = paths[0]['cnt'] if paths else 0
    print(f"Paths na base: {path_count}")

    # Sample tickets
    print("\nAmostra de tickets (últimos 10 por last_updated):")
    sample = db.execute_query('''
        SELECT name, status, nros, anoos, created, last_updated 
        FROM xpose_tickets 
        ORDER BY last_updated DESC 
        LIMIT 10
    ''')
    if sample:
        for row in sample:
            print(f"  - {row.get('name')}: status={row.get('status')}, os={row.get('nros')}/{row.get('anoos')}")
    else:
        print("  Nenhum ticket encontrado")

    # Sample paths by ticket
    print("\nAmostra de paths (últimos 10 por last_updated):")
    sample_paths = db.execute_query('''
        SELECT ticket_name, path_name, status, colour, last_updated 
        FROM xpose_paths 
        ORDER BY last_updated DESC 
        LIMIT 10
    ''')
    if sample_paths:
        for row in sample_paths:
            print(f"  - {row.get('ticket_name')}: {row.get('path_name')} ({row.get('colour')}) - {row.get('status')}")
    else:
        print("  Nenhum path encontrado")

    # Check status distribution
    print("\nDistribuição de status em xpose_tickets:")
    status_dist = db.execute_query('''
        SELECT status, COUNT(*) as cnt 
        FROM xpose_tickets 
        GROUP BY status
    ''')
    if status_dist:
        for row in status_dist:
            print(f"  - {row.get('status')}: {row.get('cnt')}")
    else:
        print("  Nenhum status encontrado")

except Exception as e:
    print(f"\nErro: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 50)
