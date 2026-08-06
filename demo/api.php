<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

$db_file = __DIR__ . '/demo_data.json';

// Seed initial data if file doesn't exist
if (!file_exists($db_file)) {
    $initial_data = [
        "os_list" => [
            [
                "nr_os" => 5021,
                "ano" => 2026,
                "produto" => "Ct Visita",
                "cores" => "4x4 (Policromia)",
                "frente_verso" => "Frente e Verso",
                "titulo" => "Cartão de Visita - Deputado Rodrigo Neves",
                "solicitante" => "Alexandre Soares (Assessor)",
                "titular" => "Rodrigo Neves",
                "partido" => "PT",
                "uf" => "SP",
                "gabinete" => "412",
                "anexo" => "IV",
                "email" => "dep.rodrigoneves@camara.leg.br",
                "status" => "pendente",
                "setor" => "PCP",
                "data_solicitacao" => "2026-06-22",
                "andamentos" => [
                    ["data" => "2026-06-22 10:15", "usuario" => "Sistema", "descricao" => "Ordem de Serviço Cadastrada via MDB Sync"],
                    ["data" => "2026-06-22 10:20", "usuario" => "Admin", "descricao" => "Aguardando preenchimento de campos de papelaria"]
                ],
                "mockup_url" => "",
                "approved_by_client" => false,
                "client_token" => "tkn-5021-x9a",
                "corel_fields" => []
            ],
            [
                "nr_os" => 5022,
                "ano" => 2026,
                "produto" => "Ct Duplo Paisagem Lateral",
                "cores" => "4x4 (Policromia)",
                "frente_verso" => "Frente e Verso",
                "titulo" => "Cartão Duplo Gabinete - Deputada Aline Silva",
                "solicitante" => "Aline Silva",
                "titular" => "Aline Silva",
                "partido" => "PL",
                "uf" => "RJ",
                "gabinete" => "254",
                "anexo" => "III",
                "email" => "dep.alinesilva@camara.leg.br",
                "status" => "producao",
                "setor" => "Impressão Digital",
                "data_solicitacao" => "2026-06-21",
                "andamentos" => [
                    ["data" => "2026-06-21 14:00", "usuario" => "Sistema", "descricao" => "Ordem de Serviço Cadastrada via MDB Sync"],
                    ["data" => "2026-06-21 14:30", "usuario" => "Lucas Santos", "descricao" => "Arte enviada para a fila de geração CorelDRAW"],
                    ["data" => "2026-06-21 14:31", "usuario" => "Worker-Corel-01", "descricao" => "Arquivo PDF/CDR gerado com sucesso. Copiado para a pasta da OS."],
                    ["data" => "2026-06-21 14:35", "usuario" => "Lucas Santos", "descricao" => "Prova enviada ao cliente via EWS (E-mail)"]
                ],
                "mockup_url" => "sample_card_double",
                "approved_by_client" => false,
                "client_token" => "tkn-5022-b2z",
                "corel_fields" => [
                    "NomeDep" => "Aline Silva",
                    "Genero" => "Deputada Federal",
                    "PartidoDep" => "PL/RJ",
                    "Endereco" => "Câmara dos Deputados, Anexo III, Gabinete 254",
                    "Contato" => "Fones: 3215-5254 / email: dep.alinesilva@camara.leg.br"
                ]
            ],
            [
                "nr_os" => 4910,
                "ano" => 2026,
                "produto" => "Panfleto A5",
                "cores" => "4x0",
                "frente_verso" => "Somente Frente",
                "titulo" => "Informativo de Atividades Parlamentares",
                "solicitante" => "Deputado Marcos Pontes",
                "titular" => "Marcos Pontes",
                "partido" => "PSD",
                "uf" => "SP",
                "gabinete" => "502",
                "anexo" => "IV",
                "email" => "dep.marcospontes@camara.leg.br",
                "status" => "concluido",
                "setor" => "Expedição",
                "data_solicitacao" => "2026-06-15",
                "andamentos" => [
                    ["data" => "2026-06-15 09:00", "usuario" => "Sistema", "descricao" => "Ordem de Serviço Cadastrada via MDB Sync"],
                    ["data" => "2026-06-15 11:15", "usuario" => "Juliana Costa", "descricao" => "Layout aprovado manualmente"],
                    ["data" => "2026-06-17 15:40", "usuario" => "C2P-Gravação", "descricao" => "Chapa gravada no C2P Xpose (Job #412)"],
                    ["data" => "2026-06-18 10:00", "usuario" => "Impressão Offset", "descricao" => "Impressão finalizada. Enviado para Acabamento."],
                    ["data" => "2026-06-19 14:00", "usuario" => "Acabamento", "descricao" => "Corte e empacotamento concluídos."],
                    ["data" => "2026-06-19 16:30", "usuario" => "Sistema", "descricao" => "OS concluída e arquivada."]
                ],
                "mockup_url" => "",
                "approved_by_client" => true,
                "client_token" => "tkn-4910-y6d",
                "corel_fields" => []
            ],
            [
                "nr_os" => 5023,
                "ano" => 2026,
                "produto" => "Timbrado A4",
                "cores" => "1x0 (Preto)",
                "frente_verso" => "Somente Frente",
                "titulo" => "Papel Timbrado Oficial - Deputado Roberto Freire",
                "solicitante" => "Roberto Freire",
                "titular" => "Roberto Freire",
                "partido" => "MDB",
                "uf" => "PE",
                "gabinete" => "923",
                "anexo" => "IV",
                "email" => "dep.robertofreire@camara.leg.br",
                "status" => "analise",
                "setor" => "Análise de Qualidade",
                "data_solicitacao" => "2026-06-22",
                "andamentos" => [
                    ["data" => "2026-06-22 11:00", "usuario" => "Sistema", "descricao" => "Ordem de Serviço Cadastrada via MDB Sync"],
                    ["data" => "2026-06-22 11:30", "usuario" => "Worker-Corel-02", "descricao" => "Arquivo PDF/CDR gerado com sucesso."],
                    ["data" => "2026-06-22 11:35", "usuario" => "Roberto Ramos", "descricao" => "Layout enviado para análise técnica de qualidade"]
                ],
                "mockup_url" => "sample_letterhead",
                "approved_by_client" => false,
                "client_token" => "tkn-5023-c4t",
                "corel_fields" => [
                    "Cabecalho" => "GABINETE DO DEPUTADO ROBERTO FREIRE\nMDB/PE",
                    "Rodape" => "Câmara dos Deputados, Anexo IV, Gabinete 923 - Fones: 3215-5923 - dep.robertofreire@camara.leg.br"
                ]
            ],
            [
                "nr_os" => 5024,
                "ano" => 2026,
                "produto" => "Ct Visita",
                "cores" => "4x4 (Policromia)",
                "frente_verso" => "Frente e Verso",
                "titulo" => "Cartão de Visita c/ Assessor - Deputado André Figueiredo",
                "solicitante" => "André Figueiredo",
                "titular" => "André Figueiredo",
                "partido" => "PDT",
                "uf" => "CE",
                "gabinete" => "341",
                "anexo" => "III",
                "email" => "dep.andrefigueiredo@camara.leg.br",
                "status" => "aprovado",
                "setor" => "C2P / Gravação",
                "data_solicitacao" => "2026-06-20",
                "andamentos" => [
                    ["data" => "2026-06-20 09:12", "usuario" => "Sistema", "descricao" => "Ordem de Serviço Cadastrada via MDB Sync"],
                    ["data" => "2026-06-20 10:15", "usuario" => "José Lima", "descricao" => "Arte enviada para a fila de geração CorelDRAW"],
                    ["data" => "2026-06-20 10:17", "usuario" => "Worker-Corel-01", "descricao" => "Geração do CDR e PDF finalizada com sucesso."],
                    ["data" => "2026-06-20 14:00", "usuario" => "Cliente (Portal)", "descricao" => "Prova visual aprovada pelo parlamentar via Token de Acesso"]
                ],
                "mockup_url" => "sample_card_assessor",
                "approved_by_client" => true,
                "client_token" => "tkn-5024-h7s",
                "corel_fields" => [
                    "NomeDep" => "André Figueiredo",
                    "Genero" => "Deputado Federal",
                    "PartidoDep" => "PDT/CE",
                    "Endereco" => "Câmara dos Deputados, Anexo III, Gabinete 341",
                    "Contato" => "Fones: 3215-5341 / dep.andrefigueiredo@camara.leg.br",
                    "NomeAssessor" => "Carlos Eduardo",
                    "ContatoAssessor" => "Celular: (85) 99999-8888",
                    "Funcao" => "Chefe de Gabinete"
                ]
            ]
        ],
        "ips" => [
            ["id" => 1, "ip" => "192.168.1.10", "setor" => "PCP", "descricao" => "Computador Central PCP", "permissao" => "MASTER_IP"],
            ["id" => 2, "ip" => "192.168.1.15", "setor" => "Impressão Digital", "descricao" => "Terminal Máquina Digital 01", "permissao" => "OPERADOR_IP"],
            ["id" => 3, "ip" => "192.168.1.20", "setor" => "Gravação C2P", "descricao" => "Console Xpose Laser", "permissao" => "OPERADOR_IP"],
            ["id" => 4, "ip" => "127.0.0.1", "setor" => "TI / Desenvolvimento", "descricao" => "Desenvolvedor Local", "permissao" => "MASTER_IP"]
        ],
        "papelaria_jobs" => [
            [
                "id" => 101,
                "nr_os" => 5022,
                "ano" => 2026,
                "produto" => "Ct Duplo Paisagem Lateral",
                "solicitante" => "Lucas Santos",
                "status" => "completed",
                "progresso" => 100,
                "log" => "Job claim successfully. CoInitialize CorelDRAW instance. Generating layouts. PDF exported. Copying final artifacts. Finished.",
                "data" => "2026-06-21 14:31"
            ],
            [
                "id" => 102,
                "nr_os" => 5023,
                "ano" => 2026,
                "produto" => "Timbrado A4",
                "solicitante" => "Roberto Ramos",
                "status" => "completed",
                "progresso" => 100,
                "log" => "Job claimed by Worker-Corel-02. Corel launched. Text variables substituted. Exported A4 Layout. Finished.",
                "data" => "2026-06-22 11:35"
            ]
        ],
        "chat_messages" => [
            ["sender" => "System", "time" => "2026-06-22 10:00", "message" => "Bem-vindo ao Chat de Suporte Interno do SAGRA. Como podemos ajudar?"],
            ["sender" => "Aline Silva (PL/RJ)", "time" => "2026-06-22 10:05", "message" => "Olá, estou aguardando a prova do meu cartão de visitas duplo. Conseguem me enviar?"],
            ["sender" => "Suporte PCP", "time" => "2026-06-22 10:10", "message" => "Bom dia Deputada! Seu arquivo já foi gerado no CorelDRAW e a prova foi enviada para o seu e-mail. Você também pode acessar o portal com seu token."]
        ],
        "active_users" => [
            ["ponto" => "918713", "nome" => "Administrador Geral", "setor" => "Tecnologia da Informação", "ultimo_acesso" => "2026-06-22 16:22"],
            ["ponto" => "254125", "nome" => "Lucas Santos", "setor" => "PCP", "ultimo_acesso" => "2026-06-22 16:15"],
            ["ponto" => "114022", "nome" => "Juliana Costa", "setor" => "Análise de Qualidade", "ultimo_acesso" => "2026-06-22 15:58"]
        ]
    ];
    file_put_contents($db_file, json_encode($initial_data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

// Read current data
$data = json_decode(file_get_contents($db_file), true);

$action = isset($_GET['action']) ? $_GET['action'] : '';

// Process API requests
switch ($action) {
    case 'get_data':
        echo json_encode($data);
        break;

    case 'reset_data':
        if (file_exists($db_file)) {
            unlink($db_file);
        }
        echo json_encode(["status" => "success", "message" => "Dados resetados para o padrão."]);
        break;

    case 'os_save':
        $raw = file_get_contents('php://input');
        $os_data = json_decode($raw, true);
        if ($os_data) {
            $found = false;
            foreach ($data['os_list'] as &$os) {
                if ($os['nr_os'] == $os_data['nr_os'] && $os['ano'] == $os_data['ano']) {
                    $os = array_merge($os, $os_data);
                    $found = true;
                    break;
                }
            }
            if (!$found) {
                // Nova OS
                $os_data['andamentos'] = [
                    ["data" => date('Y-m-d H:i'), "usuario" => "Sistema", "descricao" => "Ordem de Serviço cadastrada manualmente"]
                ];
                $os_data['approved_by_client'] = false;
                $os_data['client_token'] = "tkn-" . $os_data['nr_os'] . "-" . substr(md5(uniqid()), 0, 3);
                $data['os_list'][] = $os_data;
            }
            file_put_contents($db_file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            echo json_encode(["status" => "success", "os" => $os_data]);
        } else {
            echo json_encode(["status" => "error", "message" => "JSON inválido"]);
        }
        break;

    case 'os_status':
        $raw = file_get_contents('php://input');
        $payload = json_decode($raw, true);
        if ($payload && isset($payload['nr_os']) && isset($payload['status'])) {
            foreach ($data['os_list'] as &$os) {
                if ($os['nr_os'] == $payload['nr_os'] && $os['ano'] == $payload['ano']) {
                    $os['status'] = $payload['status'];
                    if (isset($payload['setor'])) {
                        $os['setor'] = $payload['setor'];
                    }
                    if (isset($payload['mockup_url'])) {
                        $os['mockup_url'] = $payload['mockup_url'];
                    }
                    if (isset($payload['approved_by_client'])) {
                        $os['approved_by_client'] = $payload['approved_by_client'];
                    }
                    $os['andamentos'][] = [
                        "data" => date('Y-m-d H:i'),
                        "usuario" => isset($payload['usuario']) ? $payload['usuario'] : 'Operador',
                        "descricao" => $payload['descricao']
                    ];
                    break;
                }
            }
            file_put_contents($db_file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            echo json_encode(["status" => "success"]);
        } else {
            echo json_encode(["status" => "error", "message" => "Dados insuficientes"]);
        }
        break;

    case 'create_job':
        $raw = file_get_contents('php://input');
        $payload = json_decode($raw, true);
        if ($payload && isset($payload['nr_os'])) {
            // Cria um novo Job de papelaria Corel
            $new_job_id = count($data['papelaria_jobs']) + 101;
            $new_job = [
                "id" => $new_job_id,
                "nr_os" => $payload['nr_os'],
                "ano" => $payload['ano'],
                "produto" => $payload['produto'],
                "solicitante" => $payload['usuario'],
                "status" => "pending",
                "progresso" => 0,
                "log" => "Job registered in queue. Waiting for Worker allocation...",
                "data" => date('Y-m-d H:i')
            ];
            $data['papelaria_jobs'][] = $new_job;

            // Atualiza OS para "producao" na Fila PCP
            foreach ($data['os_list'] as &$os) {
                if ($os['nr_os'] == $payload['nr_os'] && $os['ano'] == $payload['ano']) {
                    $os['status'] = "producao";
                    $os['setor'] = "PCP";
                    $os['corel_fields'] = $payload['corel_fields'];
                    $os['andamentos'][] = [
                        "data" => date('Y-m-d H:i'),
                        "usuario" => $payload['usuario'],
                        "descricao" => "Campos de papelaria enviados para geração CorelDRAW. Enfileirado no PCP."
                    ];
                    break;
                }
            }

            file_put_contents($db_file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            echo json_encode(["status" => "success", "job_id" => $new_job_id]);
        } else {
            echo json_encode(["status" => "error", "message" => "Dados insuficientes"]);
        }
        break;

    case 'update_job_status':
        $raw = file_get_contents('php://input');
        $payload = json_decode($raw, true);
        if ($payload && isset($payload['job_id'])) {
            foreach ($data['papelaria_jobs'] as &$job) {
                if ($job['id'] == $payload['job_id']) {
                    $job['status'] = $payload['status'];
                    $job['progresso'] = $payload['progresso'];
                    $job['log'] .= "\n[" . date('H:i:s') . "] " . $payload['log_step'];
                    
                    // Se completou, atualiza OS com a URL de mockup simulada
                    if ($payload['status'] == 'completed') {
                        foreach ($data['os_list'] as &$os) {
                            if ($os['nr_os'] == $job['nr_os'] && $os['ano'] == $job['ano']) {
                                $os['mockup_url'] = $payload['mockup_url'];
                                $os['status'] = "analise";
                                $os['setor'] = "Análise de Qualidade";
                                $os['andamentos'][] = [
                                    "data" => date('Y-m-d H:i'),
                                    "usuario" => "Worker-Corel-01",
                                    "descricao" => "Processamento Corel concluído. Preview 3D disponível. OS enviada para Análise de Qualidade."
                                ];
                            }
                        }
                    }
                    break;
                }
            }
            file_put_contents($db_file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            echo json_encode(["status" => "success"]);
        } else {
            echo json_encode(["status" => "error", "message" => "Dados insuficientes"]);
        }
        break;

    case 'send_chat_message':
        $raw = file_get_contents('php://input');
        $payload = json_decode($raw, true);
        if ($payload && isset($payload['message'])) {
            $new_msg = [
                "sender" => $payload['sender'],
                "time" => date('Y-m-d H:i'),
                "message" => $payload['message']
            ];
            $data['chat_messages'][] = $new_msg;
            file_put_contents($db_file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            echo json_encode(["status" => "success", "message" => $new_msg]);
        } else {
            echo json_encode(["status" => "error", "message" => "Mensagem vazia"]);
        }
        break;

    case 'ip_save':
        $raw = file_get_contents('php://input');
        $payload = json_decode($raw, true);
        if ($payload && isset($payload['ip'])) {
            $found = false;
            foreach ($data['ips'] as &$ip) {
                if ($ip['id'] == $payload['id']) {
                    $ip = $payload;
                    $found = true;
                    break;
                }
            }
            if (!$found) {
                $payload['id'] = count($data['ips']) > 0 ? max(array_column($data['ips'], 'id')) + 1 : 1;
                $data['ips'][] = $payload;
            }
            file_put_contents($db_file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            echo json_encode(["status" => "success", "ip" => $payload]);
        } else {
            echo json_encode(["status" => "error", "message" => "Dados inválidos"]);
        }
        break;

    case 'ip_delete':
        $id = isset($_GET['id']) ? intval($_GET['id']) : 0;
        if ($id > 0) {
            $data['ips'] = array_values(array_filter($data['ips'], function($ip) use ($id) {
                return $ip['id'] != $id;
            }));
            file_put_contents($db_file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            echo json_encode(["status" => "success"]);
        } else {
            echo json_encode(["status" => "error", "message" => "ID inválido"]);
        }
        break;

    default:
        echo json_encode(["error" => "Ação desconhecida"]);
        break;
}
?>
