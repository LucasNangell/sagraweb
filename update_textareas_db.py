
from database import db
import json
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def update_textareas():
    try:
        query = "SELECT NomeProduto, ConfigCampos FROM tabPapelariaModelos WHERE Ativo = 1"
        results = db.execute_query(query)
        
        logger.info(f"Scanning {len(results)} models...")
        
        updated_count = 0
        
        # Keys or Labels to target
        target_keys = ['endereco', 'contato', 'rodape'] # lowercase check
        
        for row in results:
            nome_produto = row['NomeProduto']
            config_str = row['ConfigCampos']
            
            if not config_str:
                continue
                
            try:
                config = json.loads(config_str)
            except:
                continue
                
            if not isinstance(config, list):
                continue
            
            changed = False
            for field in config:
                # Check Key or Label
                key = str(field.get('key', '')).lower()
                label = str(field.get('label', '')).lower()
                
                # Logic: If it matches target keys, make it a textarea
                is_target = any(k in key for k in target_keys) or any(k in label for k in target_keys)
                
                if is_target:
                    # Update properties
                    field['type'] = 'textarea'
                    field['rows'] = 4
                    logger.info(f"[{nome_produto}] Updated field '{field.get('key')}' to textarea/4 rows.")
                    changed = True
            
            if changed:
                new_config_str = json.dumps(config)
                update_query = "UPDATE tabPapelariaModelos SET ConfigCampos = %s WHERE NomeProduto = %s"
                db.execute_query(update_query, (new_config_str, nome_produto))
                updated_count += 1
                
        logger.info(f"Completed. Total models updated: {updated_count}")
        
    except Exception as e:
        logger.error(f"Error: {e}")

if __name__ == "__main__":
    update_textareas()
