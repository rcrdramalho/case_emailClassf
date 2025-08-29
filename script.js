// Elementos do DOM
const uploadForm = document.getElementById("uploadForm");
const fileInput = document.getElementById("file");
const textInput = document.getElementById("text");
const removeFileBtn = document.getElementById("removeFile");
const fileInfo = document.getElementById("fileInfo");
const resposta = document.getElementById("resposta");

// Event listeners
uploadForm.addEventListener("submit", handleSubmit);
fileInput.addEventListener("change", handleFileChange);
removeFileBtn.addEventListener("click", handleRemoveFile);

// Função para lidar com mudança no input de arquivo
function handleFileChange(e) {
    const file = e.target.files[0];

    if (file) {
        // Mostra informações do arquivo
        const fileSize = (file.size / 1024).toFixed(1);
        const fileType = file.type === "application/pdf" ? "PDF" : "TXT";

        fileInfo.textContent = `📁 Arquivo selecionado: ${file.name} (${fileSize} KB - ${fileType})`;
        fileInfo.classList.add("file-selected");

        // Mostra o botão de remover
        removeFileBtn.style.display = "block";
    } else {
        resetFileInfo();
    }
}

// Função para remover arquivo selecionado
function handleRemoveFile() {
    fileInput.value = "";
    resetFileInfo();
}

// Função para resetar informações do arquivo
function resetFileInfo() {
    fileInfo.textContent = "Ou deixe em branco para enviar apenas o texto abaixo.";
    fileInfo.classList.remove("file-selected");
    removeFileBtn.style.display = "none";
}

// Função principal de submit
async function handleSubmit(e) {
    e.preventDefault();

    const textValue = textInput.value.trim();

    // Mostra loading
    resposta.textContent = "🔄 Classificando email...";
    resposta.className = "loading";

    if (fileInput.files.length > 0) {
        // Processa arquivo
        const file = fileInput.files[0];
        await processFile(file);
    } else if (textValue.length > 0) {
        // Processa texto
        await enviarParaLambda(textValue, false);
    } else {
        showError("❌ Por favor, insira texto ou selecione um arquivo.");
    }
}

// Função para processar arquivo
async function processFile(file) {
    const reader = new FileReader();

    reader.onload = async function() {
        if (file.type === "application/pdf" || file.type === "text/plain") {
            const bytes = new Uint8Array(reader.result);
            const base64String = btoa(String.fromCharCode(...bytes));
            await enviarParaLambda(base64String, true);
        } else {
            showError("❌ Tipo de arquivo não suportado. Use apenas .txt ou .pdf");
        }
    };

    reader.onerror = function() {
        showError("❌ Erro ao ler o arquivo. Tente novamente.");
    };

    reader.readAsArrayBuffer(file);
}

// Função para enviar dados para Lambda
async function enviarParaLambda(bodyData, isBase64) {
    try {
        const lambdaUrl = "https://kcp02bv6wa.execute-api.sa-east-1.amazonaws.com/cases";

        console.log("URL da requisição:", lambdaUrl);
        console.log("Body enviado:", bodyData.substring(0, 100) + "...");

        const payload = {
            body: bodyData,
            isBase64Encoded: isBase64
        };

        const response = await fetch(lambdaUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const resData = await response.json();
        showResponse(resData);

    } catch (err) {
        console.error("Erro na requisição:", err);
        showError(`❌ Erro na conexão: ${err.message}`);
    }
}

// Função para mostrar resposta
function showResponse(data) {
    resposta.className = "";

    try {
        // Tenta parsear se a resposta vier como string
        const parsedData = typeof data === 'string' ? JSON.parse(data) : data;

        // Verifica se há classificação
        if (parsedData.classificacao) {
            const classificacao = parsedData.classificacao;

            // Formata a resposta de forma mais legível
            let resultado = "";

            if (classificacao.includes("Produtivo") || classificacao.includes("Não produtivo")) {
                const isProdutivo = classificacao.includes("Produtivo") && !classificacao.includes("Não produtivo");
                resultado = `
🎯 CLASSIFICAÇÃO: ${isProdutivo ? "📧 PRODUTIVO" : "📄 NÃO PRODUTIVO"}

${isProdutivo ?
                    "✅ Este email requer uma ação ou resposta específica." :
                    "ℹ️  Este email é apenas informativo e não exige ação imediata."}

📊 Resposta completa da API:
${JSON.stringify(parsedData, null, 2)}`;

                resposta.className = isProdutivo ? "success" : "";
            } else {
                // Caso haja erro na classificação
                resultado = `❌ ERRO NA CLASSIFICAÇÃO:\n\n${classificacao}\n\n📊 Dados completos:\n${JSON.stringify(parsedData, null, 2)}`;
                resposta.className = "error";
            }

            resposta.textContent = resultado;
        } else {
            resposta.textContent = JSON.stringify(parsedData, null, 2);
        }

    } catch (parseError) {
        resposta.textContent = JSON.stringify(data, null, 2);
    }
}

// Função para mostrar erro
function showError(message) {
    resposta.textContent = message;
    resposta.className = "error";
}

// Reset do formulário
uploadForm.addEventListener("reset", function() {
    resetFileInfo();
    resposta.textContent = "Aguardando envio...";
    resposta.className = "";
});