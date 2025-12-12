
from database import db
import json
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def remove_tratamento():
    try:
        query = "SELECT NomeProduto, ConfigCampos FROM tabPapelariaModelos WHERE Ativo = 1"
        results = db.execute_query(query)
        
        logger.info(f"Scanning {len(results)} models...")
        
        updated_count = 0
        
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
            
            # Filter out Tratamento
            new_config = [
                field for field in config 
                if field.get('shape') != 'Tratamento' and field.get('key') != 'Tratamento' and field.get('label') != 'Tratamento'
            ]
            
            if len(new_config) != len(config):
                new_config_str = json.dumps(new_config)
                update_query = "UPDATE tabPapelariaModelos SET ConfigCampos = %s WHERE NomeProduto = %s"
                db.execute_query(update_query, (new_config_str, nome_produto))
                logger.info(f"[{nome_produto}] Removed 'Tratamento'.")
                updated_count += 1
                
        logger.info(f"Completed. Total models updated: {updated_count}")
        
    except Exception as e:
        logger.error(f"Error: {e}")

if __name__ == "__main__":
    remove_tratamento()
