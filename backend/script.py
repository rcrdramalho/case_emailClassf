import json
import base64
import io
import os
import requests
import time
import re
from datetime import datetime

try:
    import PyPDF2
except ImportError:
    # PyPDF2 deve estar empacotada junto com a Lambda
    pass

GEMINI_API_KEY = "AIzaSyDevgBj3BMJTBiLeuoBBIZRrWFuo"

# URLs dos modelos (com fallback)
GEMINI_MODELS = [
    {
        "name": "gemini-1.5-flash",
        "url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
        "max_tokens": 50
    },
    {
        "name": "gemini-pro", 
        "url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        "max_tokens": 100
    }
]

def classificar_email(texto, confidence=0, detailed=False, include_response=False):
    """
    Usa Gemini para classificar o email como Produtivo ou Não produtivo.
    
    Args:
        texto (str): Conteúdo do email
        confidence (float): Nível de confiança (0-1, onde 0=rápido, 1=conservador)
        detailed (bool): Se deve incluir justificativa detalhada
        include_response (bool): Se deve incluir recomendação de resposta
    """
    
    # Ajusta o prompt baseado nas configurações
    base_prompt = """
Você é um assistente especializado que classifica emails em duas categorias:

- Produtivo: Emails que requerem uma ação ou resposta específica (ex.: solicitações de suporte técnico, atualização sobre casos em aberto, dúvidas sobre o sistema, agendamentos, confirmações necessárias).
- Não produtivo: Emails que são apenas informativos, publicitários, newsletters ou não exigem ação imediata.

IMPORTANTE: Analise cuidadosamente o contexto e a intenção do email. Emails que parecem informativos mas requerem confirmação ou ação são PRODUTIVOS.
"""
    
    if include_response:
        classification_request = """
Classifique o email abaixo e forneça:
1. Classificação: "Produtivo" ou "Não produtivo"
2. Justificativa: Explique em 1-2 frases o motivo da classificação
3. Confiança: Indique sua confiança de 1-10
4. Recomendação de Resposta: Forneça uma sugestão de resposta apropriada (máximo 200 palavras)

Formato da resposta:
Classificação: [Produtivo/Não produtivo]
Justificativa: [Sua explicação]
Confiança: [1-10]
Recomendação: [Sugestão de resposta ou "Não requer resposta" se for não produtivo]
"""
        max_tokens = 400
    elif detailed:
        classification_request = """
Classifique o email abaixo e forneça:
1. Classificação: "Produtivo" ou "Não produtivo"
2. Justificativa: Explique em 1-2 frases o motivo da classificação
3. Confiança: Indique sua confiança de 1-10

Formato da resposta:
Classificação: [Produtivo/Não produtivo]
Justificativa: [Sua explicação]
Confiança: [1-10]
"""
        max_tokens = 150
    else:
        classification_request = "Classifique o seguinte email e responda apenas com 'Produtivo' ou 'Não produtivo':"
        max_tokens = 20
    
    prompt = f"{base_prompt}\n{classification_request}\n\nEmail:\n\"\"\"{texto}\"\"\""
    
    headers = {
        "Content-Type": "application/json"
    }
    
    # Ajusta temperatura baseado no nível de confiança
    temperature = confidence * 0.3  # 0 a 0.3
    
    payload = {
        "contents": [{
            "parts": [{
                "text": prompt
            }]
        }],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
            "topP": 0.8,
            "topK": 40
        }
    }
    
    # Tenta cada modelo com retry
    for model_info in GEMINI_MODELS:
        model_name = model_info["name"]
        model_url = model_info["url"]
        
        print(f"Tentando modelo: {model_name}")
        
        for attempt in range(3):  # 3 tentativas por modelo
            try:
                print(f"Tentativa {attempt + 1}/3 com {model_name}")
                
                response = requests.post(
                    f"{model_url}?key={GEMINI_API_KEY}",
                    headers=headers,
                    json=payload,
                    timeout=30
                )
                
                if response.status_code == 200:
                    result = response.json()
                    
                    # Verifica se a resposta está completa
                    if "candidates" in result and len(result["candidates"]) > 0:
                        if "content" in result["candidates"][0] and "parts" in result["candidates"][0]["content"]:
                            classificacao = result["candidates"][0]["content"]["parts"][0]["text"].strip()
                            
                            # Log de sucesso
                            print(f"Classificação bem-sucedida com {model_name}")
                            
                            return {
                                "classificacao": classificacao,
                                "modelo_usado": model_name,
                                "tentativas": attempt + 1,
                                "timestamp": datetime.now().isoformat(),
                                "confidence_nivel": confidence,
                                "detailed": detailed,
                                "include_response": include_response
                            }
                    
                    return {"erro": "Resposta incompleta da API", "resposta_raw": result}
                    
                elif response.status_code == 503:
                    print(f"Modelo {model_name} sobrecarregado (503). Tentativa {attempt + 1}/3")
                    if attempt < 2:  # Se não for a última tentativa
                        wait_time = (2 ** attempt) + (attempt * 0.5)  # Backoff: 1s, 2.5s, 5s
                        print(f"Aguardando {wait_time}s antes da próxima tentativa...")
                        time.sleep(wait_time)
                    continue
                    
                elif response.status_code == 429:
                    print(f"Rate limit atingido (429). Tentativa {attempt + 1}/3")
                    if attempt < 2:
                        time.sleep(5)  # Aguarda 5 segundos para rate limit
                    continue
                    
                else:
                    print(f"Erro {response.status_code} com {model_name}: {response.text}")
                    break  # Tenta próximo modelo
                    
            except requests.exceptions.Timeout:
                print(f"Timeout na tentativa {attempt + 1} com {model_name}")
                if attempt < 2:
                    time.sleep(1)
                continue
                
            except requests.exceptions.RequestException as e:
                print(f"Erro de conexão com {model_name}: {str(e)}")
                if attempt < 2:
                    time.sleep(1)
                continue
                
            except Exception as e:
                print(f"Erro inesperado com {model_name}: {str(e)}")
                break
    
    # Se chegou até aqui, todos os modelos falharam
    return {
        "erro": "Todos os modelos estão indisponíveis no momento",
        "detalhes": "Tente novamente em alguns minutos. Os servidores podem estar sobrecarregados.",
        "timestamp": datetime.now().isoformat()
    }

def extrair_texto_pdf(body_bytes):
    """
    Extrai texto de PDF com tratamento de erros melhorado.
    """
    try:
        reader = PyPDF2.PdfReader(io.BytesIO(body_bytes))
        texto = ""
        
        for i, page in enumerate(reader.pages):
            try:
                page_text = page.extract_text() or ""
                texto += page_text
                
                # Log para debug
                print(f"Página {i+1}: {len(page_text)} caracteres extraídos")
                
            except Exception as page_error:
                print(f"Erro ao extrair página {i+1}: {str(page_error)}")
                continue
        
        if not texto.strip():
            return {"erro": "PDF não contém texto extraível ou está protegido"}
            
        return {"texto": texto, "paginas": len(reader.pages)}
        
    except Exception as e:
        return {"erro": f"Erro ao processar PDF: {str(e)}"}

def processar_texto(texto):
    """
    Processa e limpa o texto do email.
    """
    # Remove caracteres de controle e excesso de espaços
    texto_limpo = re.sub(r'\s+', ' ', texto.strip())
    
    # Limite de tamanho (50KB para evitar timeouts)
    if len(texto_limpo) > 50000:
        texto_limpo = texto_limpo[:50000] + "... [texto truncado]"
        
    return {
        "texto_original": texto,
        "texto_processado": texto_limpo,
        "tamanho_original": len(texto),
        "tamanho_processado": len(texto_limpo),
        "foi_truncado": len(texto) > 50000
    }

def lambda_handler(event, context):
    start_time = time.time()
    
    try:
        # Headers CORS para o frontend
        cors_headers = {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        }
        
        # Trata requisições OPTIONS (CORS preflight)
        if event.get("httpMethod") == "OPTIONS":
            return {
                "statusCode": 200,
                "headers": cors_headers,
                "body": json.dumps({"message": "CORS OK"})
            }
        
        # Verifica se a API Key está configurada
        if not GEMINI_API_KEY:
            return {
                "statusCode": 500,
                "headers": cors_headers,
                "body": json.dumps({
                    "erro": "GEMINI_API_KEY não configurada",
                    "timestamp": datetime.now().isoformat()
                })
            }
        
        # Parse do body da requisição
        request_body = event.get("body", "")
        if not request_body:
            return {
                "statusCode": 400,
                "headers": cors_headers,
                "body": json.dumps({"erro": "Nenhum body recebido"})
            }
        
        # Parse do JSON
        try:
            if isinstance(request_body, str):
                data = json.loads(request_body)
            else:
                data = request_body
        except json.JSONDecodeError:
            return {
                "statusCode": 400,
                "headers": cors_headers,
                "body": json.dumps({"erro": "JSON inválido no body"})
            }
        
        # Extrai parâmetros
        body_content = data.get("body", "")
        is_base64 = data.get("isBase64Encoded", False)
        options = data.get("options", {})
        confidence = options.get("confidence", 0)
        detailed = options.get("detailed", False)
        include_response = options.get("include_response", False)
        
        print(f"Processando requisição - Base64: {is_base64}, Detailed: {detailed}, Include Response: {include_response}, Confidence: {confidence}")
        
        if not body_content:
            return {
                "statusCode": 400,
                "headers": cors_headers,
                "body": json.dumps({"erro": "Conteúdo vazio"})
            }

        # Processa o conteúdo
        if is_base64:
            try:
                body_bytes = base64.b64decode(body_content)
            except Exception as e:
                return {
                    "statusCode": 400,
                    "headers": cors_headers,
                    "body": json.dumps({"erro": f"Erro ao decodificar base64: {str(e)}"})
                }
        else:
            body_bytes = body_content.encode("utf-8")

        # Detecta e processa PDF
        if body_bytes[:4] == b"%PDF":
            print("Detectado arquivo PDF")
            pdf_result = extrair_texto_pdf(body_bytes)
            
            if "erro" in pdf_result:
                return {
                    "statusCode": 400,
                    "headers": cors_headers,
                    "body": json.dumps(pdf_result)
                }
            
            texto_final = pdf_result["texto"]
            metadata = {
                "tipo_arquivo": "PDF",
                "paginas": pdf_result["paginas"],
                "tamanho_extraido": len(texto_final)
            }
        else:
            # Processa texto simples
            try:
                texto_bruto = body_bytes.decode("utf-8")
                print("Processando texto simples")
                metadata = {
                    "tipo_arquivo": "TXT",
                    "tamanho_original": len(texto_bruto)
                }
                texto_final = texto_bruto
            except UnicodeDecodeError:
                return {
                    "statusCode": 400,
                    "headers": cors_headers,
                    "body": json.dumps({"erro": "Não foi possível decodificar o texto"})
                }

        # Processa e limpa o texto
        texto_info = processar_texto(texto_final)
        texto_para_classificar = texto_info["texto_processado"]
        
        # Validação de conteúdo mínimo
        if len(texto_para_classificar.strip()) < 20:
            return {
                "statusCode": 400,
                "headers": cors_headers,
                "body": json.dumps({
                    "erro": "Texto muito curto para classificação",
                    "minimo_caracteres": 20,
                    "caracteres_recebidos": len(texto_para_classificar.strip())
                })
            }

        # Chama Gemini para classificar
        print(f"Iniciando classificação com {len(texto_para_classificar)} caracteres")
        resultado_classificacao = classificar_email(texto_para_classificar, confidence, detailed, include_response)

        # Calcula tempo de processamento
        processing_time = round((time.time() - start_time) * 1000, 2)  # em ms
        
        # Monta resposta final
        if isinstance(resultado_classificacao, dict) and "erro" in resultado_classificacao:
            # Erro na classificação
            response_data = {
                "status": "erro",
                "erro": resultado_classificacao["erro"],
                "detalhes": resultado_classificacao.get("detalhes", ""),
                "metadata": {
                    **metadata,
                    "processing_time_ms": processing_time,
                    "timestamp": datetime.now().isoformat(),
                    "configuracoes": {
                        "confidence": confidence,
                        "detailed": detailed,
                        "include_response": include_response
                    }
                }
            }
            
            return {
                "statusCode": 500,
                "headers": cors_headers,
                "body": json.dumps(response_data, ensure_ascii=False)
            }
        else:
            # Classificação bem-sucedida
            
            # Parse da resposta se for detalhada ou incluir recomendação
            if (detailed or include_response) and isinstance(resultado_classificacao, dict):
                classificacao_final = parse_detailed_response(resultado_classificacao["classificacao"], include_response)
            else:
                classificacao_final = {
                    "categoria": resultado_classificacao if isinstance(resultado_classificacao, str) else resultado_classificacao.get("classificacao", "Erro"),
                    "justificativa": "Classificação baseada em análise automática do conteúdo.",
                    "confianca": 95,
                    "recomendacao_resposta": "Análise simples não inclui recomendação de resposta." if include_response else None
                }
            
            response_data = {
                "status": "sucesso",
                "classificacao": classificacao_final["categoria"],
                "justificativa": classificacao_final.get("justificativa", ""),
                "confianca": classificacao_final.get("confianca", 95),
                "recomendacao_resposta": classificacao_final.get("recomendacao_resposta"),
                "texto": texto_para_classificar if len(texto_para_classificar) < 2000 else texto_para_classificar[:2000] + "...",
                "metadata": {
                    **metadata,
                    **texto_info,
                    "processing_time_ms": processing_time,
                    "timestamp": datetime.now().isoformat(),
                    "configuracoes": {
                        "confidence": confidence,
                        "detailed": detailed,
                        "include_response": include_response
                    },
                    "modelo_info": resultado_classificacao.get("modelo_usado", "gemini-1.5-flash") if isinstance(resultado_classificacao, dict) else "gemini-1.5-flash"
                },
                "debug": {
                    "tentativas": resultado_classificacao.get("tentativas", 1) if isinstance(resultado_classificacao, dict) else 1,
                    "request_id": context.aws_request_id if context else "local-test"
                }
            }

            return {
                "statusCode": 200,
                "headers": cors_headers,
                "body": json.dumps(response_data, ensure_ascii=False)
            }

    except json.JSONDecodeError as e:
        return {
            "statusCode": 400,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps({
                "erro": "JSON inválido",
                "detalhes": str(e),
                "timestamp": datetime.now().isoformat()
            })
        }
    except Exception as e:
        print(f"Erro crítico: {str(e)}")
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps({
                "erro": "Erro interno do servidor",
                "detalhes": str(e),
                "timestamp": datetime.now().isoformat(),
                "event_debug": {
                    "httpMethod": event.get("httpMethod", ""),
                    "headers": event.get("headers", {}),
                    "requestId": context.aws_request_id if context else "local-test"
                }
            }, ensure_ascii=False)
        }

def parse_detailed_response(response_text, include_response=False):
    """
    Faz parse da resposta detalhada do Gemini de forma mais robusta.
    """
    try:
        result = {
            "categoria": "Não classificado",
            "justificativa": "Não foi possível extrair a justificativa.",
            "confianca": 50,
            "recomendacao_resposta": None
        }

        # Tenta encontrar a classificação geral primeiro
        if "não produtivo" in response_text.lower():
            result["categoria"] = "Não produtivo"
        elif "produtivo" in response_text.lower():
            result["categoria"] = "Produtivo"

        # Usa regex para extrair os detalhes de forma flexível
        class_match = re.search(r"Classificação:\s*(.+)", response_text, re.IGNORECASE | re.MULTILINE)
        if class_match:
            result["categoria"] = class_match.group(1).strip()

        just_match = re.search(r"Justificativa:\s*(.+)", response_text, re.IGNORECASE | re.MULTILINE)
        if just_match:
            # Pega tudo até a próxima seção ou fim
            justificativa_text = just_match.group(1)
            # Se tiver próxima seção (Confiança ou Recomendação), para ali
            next_section = re.search(r"(Confiança:|Recomendação:)", justificativa_text, re.IGNORECASE)
            if next_section:
                justificativa_text = justificativa_text[:next_section.start()].strip()
            result["justificativa"] = justificativa_text.strip()

        conf_match = re.search(r"Confiança:\s*(\d+)", response_text, re.IGNORECASE | re.MULTILINE)
        if conf_match:
            confianca = int(conf_match.group(1))
            # Converte escala 1-10 para porcentagem
            result["confianca"] = min(100, max(0, confianca * 10))

        # Extrai recomendação de resposta se solicitada
        if include_response:
            recom_match = re.search(r"Recomendação:\s*(.+?)(?=\n\n|\Z)", response_text, re.IGNORECASE | re.DOTALL)
            if recom_match:
                recomendacao = recom_match.group(1).strip()
                result["recomendacao_resposta"] = recomendacao
            else:
                result["recomendacao_resposta"] = "Não foi possível gerar recomendação de resposta."

        return result

    except Exception as e:
        print(f"Erro ao fazer parse da resposta detalhada: {str(e)}")
        # Retorno de segurança caso o 'try' falhe
        return {
            "categoria": response_text.strip().split('\n')[0],  # Pega a primeira linha como fallback
            "justificativa": "Classificação baseada em análise automática.",
            "confianca": 90,
            "recomendacao_resposta": "Erro ao processar recomendação." if include_response else None
        }


def health_check():
    """
    Função para verificar saúde da API.
    """
    try:
        test_prompt = "Classifique: 'Email teste'. Responda apenas 'Produtivo' ou 'Não produtivo'."
        
        headers = {"Content-Type": "application/json"}
        payload = {
            "contents": [{"parts": [{"text": test_prompt}]}],
            "generationConfig": {"temperature": 0, "maxOutputTokens": 10}
        }
        
        # Garante que GEMINI_API_KEY e GEMINI_MODELS estão acessíveis
        if not GEMINI_API_KEY or not GEMINI_MODELS:
            raise ValueError("Variáveis de configuração da API não encontradas.")

        response = requests.post(
            f"{GEMINI_MODELS[0]['url']}?key={GEMINI_API_KEY}",
            headers=headers,
            json=payload,
            timeout=10
        )
        
        return {
            "status": "healthy" if response.status_code == 200 else "unhealthy",
            "response_code": response.status_code,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        return {
            "status": "unhealthy",
            "erro": str(e),
            "timestamp": datetime.now().isoformat()
        }
