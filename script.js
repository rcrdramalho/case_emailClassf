// Elementos do DOM
const uploadForm = document.getElementById("uploadForm");
const fileInput = document.getElementById("file");
const textInput = document.getElementById("text");
const removeFileBtn = document.getElementById("removeFile");
const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileSize = document.getElementById("fileSize");
const filePreview = document.getElementById("filePreview");
const fileUploadArea = document.getElementById("fileUploadArea");
const resposta = document.getElementById("resposta");
const loadingOverlay = document.getElementById("loadingOverlay");
const classificationResult = document.getElementById("classificationResult");
const classificationLabel = document.getElementById("classificationLabel");
const classificationExplanation = document.getElementById("classificationExplanation");
const confidenceLevel = document.getElementById("confidenceLevel");
const confidenceText = document.getElementById("confidenceText");
const responseActions = document.querySelector(".response-actions");
const charCount = document.getElementById("charCount");
const exampleBtn = document.getElementById("exampleBtn");
const copyResultBtn = document.getElementById("copyResult");
const exportResultBtn = document.getElementById("exportResult");
const historyContainer = document.getElementById("historyContainer");
const clearHistoryBtn = document.getElementById("clearHistory");
const totalProcessedSpan = document.getElementById("totalProcessed");
const successRateSpan = document.getElementById("successRate");

// Variáveis globais
let currentClassification = null;
let classificationHistory = [];
let stats = { total: 0, successful: 0 };

// Inicialização
document.addEventListener("DOMContentLoaded", function() {
    loadHistory();
    loadStats();
    updateCharCounter();
});

// Event listeners
uploadForm.addEventListener("submit", handleSubmit);
uploadForm.addEventListener("reset", () => {
    resetFileInfo();
    hideResults();
    resposta.textContent = "Aguardando classificação...";
    resposta.className = "";
    updateCharCounter();
    showToast("Formulário limpo!", "info");
});
fileInput.addEventListener("change", handleFileChange);
removeFileBtn.addEventListener("click", handleRemoveFile);
textInput.addEventListener("input", updateCharCounter);
textInput.addEventListener("blur", function() {
    const text = this.value.trim();
    if (text.length > 0 && text.length < 50) {
        showToast("Texto muito curto. Adicione mais conteúdo para melhor classificação.", "warning");
    }
});
exampleBtn.addEventListener("click", loadExample);
copyResultBtn.addEventListener("click", copyResult);
exportResultBtn.addEventListener("click", exportResult);
clearHistoryBtn.addEventListener("click", clearHistory);

// Drag & Drop para arquivo
fileUploadArea.addEventListener("click", () => fileInput.click());
fileUploadArea.addEventListener("dragover", handleDragOver);
fileUploadArea.addEventListener("drop", handleDrop);
fileUploadArea.addEventListener("dragleave", handleDragLeave);

// Atalhos de teclado
document.addEventListener("keydown", function(e) {
    // Ctrl/Cmd + Enter para enviar
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        uploadForm.dispatchEvent(new Event("submit"));
    }
    // Escape para limpar
    if (e.key === "Escape") {
        uploadForm.reset();
    }
});

// Função para contar caracteres
function updateCharCounter() {
    const count = textInput.value.length;
    charCount.textContent = count.toLocaleString();
    if (count > 10000) {
        charCount.style.color = "var(--error-color)";
    } else if (count > 5000) {
        charCount.style.color = "var(--warning-color)";
    } else {
        charCount.style.color = ""; // Volta para a cor padrão
    }
}

// Funções de Drag & Drop
function handleDragOver(e) {
    e.preventDefault();
    fileUploadArea.classList.add("drag-over");
}

function handleDragLeave(e) {
    e.preventDefault();
    fileUploadArea.classList.remove("drag-over");
}

function handleDrop(e) {
    e.preventDefault();
    fileUploadArea.classList.remove("drag-over");
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        fileInput.files = files;
        handleFileChange({ target: { files } });
    }
}

// Funções de manipulação de arquivo
function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) {
        resetFileInfo();
        return;
    }
    if (file.size > 10 * 1024 * 1024) { // Validação de 10MB
        showToast("Arquivo muito grande! Máximo 10MB permitido.", "error");
        fileInput.value = "";
        return;
    }

    const fileSizeKB = (file.size / 1024).toFixed(1);
    const fileType = file.type === "application/pdf" ? "PDF" : "TXT";
    fileName.textContent = `📁 ${file.name}`;
    fileSize.textContent = `${fileSizeKB} KB • ${fileType}`;
    fileInfo.style.display = "block";

    if (file.type === "text/plain") {
        previewTextFile(file);
    } else {
        filePreview.style.display = "none";
    }
    showToast(`Arquivo "${file.name}" carregado com sucesso!`, "success");
}

function previewTextFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const content = e.target.result;
        filePreview.textContent = content.length > 500 ? content.substring(0, 500) + "..." : content;
        filePreview.style.display = "block";
    };
    reader.readAsText(file);
}

function handleRemoveFile() {
    fileInput.value = "";
    resetFileInfo();
    showToast("Arquivo removido", "info");
}

function resetFileInfo() {
    fileInfo.style.display = "none";
    filePreview.style.display = "none";
}

// Função para carregar exemplo
function loadExample() {
    textInput.value = `Assunto: Solicitação de Suporte Técnico - Urgente
De: joao.silva@empresa.com
Para: suporte@sistema.com
Data: ${new Date().toLocaleDateString("pt-BR")}

Prezado time de suporte,
Estou enfrentando dificuldades para acessar o sistema desde ontem. Quando tento fazer login, recebo a mensagem "Erro de autenticação".
Já tentei limpar o cache, usar outro navegador e resetar minha senha, sem sucesso.
Por favor, preciso de ajuda com urgência para acessar relatórios importantes.

Atenciosamente,
João Silva`;
    updateCharCounter();
    showToast("Exemplo carregado! Agora você pode classificar.", "info");
}

// Funções principais (Submit e API)
async function handleSubmit(e) {
    e.preventDefault();
    const textValue = textInput.value.trim();
    if (fileInput.files.length === 0 && textValue.length === 0) {
        showToast("Por favor, insira texto ou selecione um arquivo.", "error");
        return;
    }

    showLoading(true);
    hideResults();

    try {
        if (fileInput.files.length > 0) {
            await processFile(fileInput.files[0]);
        } else {
            await enviarParaLambda(textValue, false);
        }
    } catch (error) {
        showError(`Erro inesperado: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

async function processFile(file) {
    const reader = new FileReader();
    reader.onload = async function() {
        const bytes = new Uint8Array(reader.result);
        const base64String = btoa(String.fromCharCode(...bytes));
        await enviarParaLambda(base64String, true);
    };
    reader.onerror = () => showError("Erro ao ler o arquivo.");
    reader.readAsArrayBuffer(file);
}

async function enviarParaLambda(bodyData, isBase64) {
    const lambdaUrl = "https://kcp02bv6wa.execute-api.sa-east-1.amazonaws.com/cases";
    const payload = {
        body: bodyData,
        isBase64Encoded: isBase64,
        options: {
            confidence: parseFloat(document.getElementById("confidence").value),
            detailed: document.getElementById("detailed").checked
        }
    };

    try {
        const response = await fetch(lambdaUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(payload)
        });

        const resData = await response.json();

        if (!response.ok || resData.status === "erro") {
            throw new Error(resData.erro || `HTTP ${response.status}: ${response.statusText}`);
        }

        stats.total++;
        if (resData.classificacao) stats.successful++;

        showResponse(resData);
        addToHistory(resData, isBase64 ? "Arquivo Binário" : bodyData);
        updateStats();
        showToast("Classificação concluída com sucesso!", "success");

    } catch (err) {
        console.error("Erro na requisição:", err);
        showError(`Erro na conexão: ${err.message}`);
        showToast("Erro ao conectar com o servidor", "error");
    }
}

// Funções de UI (Loading, Resposta, Erro)
function showLoading(show) {
    loadingOverlay.style.display = show ? "flex" : "none";
}

function showResponse(data) {
    try {
        currentClassification = data;
        const { classificacao = "N/A", justificativa = "Sem justificativa.", confianca = 95, metadata = {}, debug = {} } = data;

        const isProdutivo = classificacao.toLowerCase().includes("produtivo") && !classificacao.toLowerCase().includes("não");

        classificationLabel.textContent = isProdutivo ? "📧 Produtivo" : "📄 Não Produtivo";
        classificationLabel.className = isProdutivo ? "badge-produtivo" : "badge-nao-produtivo";
        classificationExplanation.textContent = justificativa;

        const confidenceNum = Math.min(100, Math.max(0, parseInt(confianca)));
        confidenceLevel.style.width = `${confidenceNum}%`;
        confidenceText.textContent = `${confidenceNum}%`;
        confidenceLevel.style.background = confidenceNum >= 90 ? "var(--success-color)" : confidenceNum >= 70 ? "var(--warning-color)" : "var(--error-color)";

        let debugInfo = `\n\n--- Informações Técnicas ---\n`;
        debugInfo += `• Tempo: ${metadata.processing_time_ms || 0}ms\n`;
        debugInfo += `• Modelo: ${metadata.modelo_info || 'N/A'}\n`;
        if (metadata.foi_truncado) debugInfo += `• Aviso: O texto foi truncado.\n`;
        if (debug.tentativas) debugInfo += `• Tentativas: ${debug.tentativas}\n`;

        resposta.textContent = JSON.stringify(data, null, 2) + debugInfo;
        classificationResult.style.display = "block";
        responseActions.style.display = "flex";

    } catch (e) {
        console.error("Erro ao processar resposta:", e);
        showError("Erro ao processar a resposta do servidor.");
        resposta.textContent = JSON.stringify(data, null, 2);
    }
}

function showError(message) {
    resposta.textContent = `❌ ${message}`;
    resposta.className = "error";
    hideResults();
}

function hideResults() {
    classificationResult.style.display = "none";
    responseActions.style.display = "none";
}

function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    const icons = { success: "✅", error: "❌", info: "ℹ️", warning: "⚠️" };
    toast.innerHTML = `<div class="toast-content"><span class="toast-icon">${icons[type]}</span><span class="toast-message">${message}</span><button class="toast-close" onclick="this.parentElement.parentElement.remove()">×</button></div>`;
    document.getElementById("toastContainer").appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

// Funções de Copiar e Exportar
function copyResult() {
    if (currentClassification) {
        navigator.clipboard.writeText(JSON.stringify(currentClassification, null, 2))
            .then(() => showToast("Resultado copiado!", "success"))
            .catch(() => showToast("Erro ao copiar", "error"));
    }
}

function exportResult() {
    if (currentClassification) {
        const dataStr = JSON.stringify(currentClassification, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `classificacao-${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
        showToast("Resultado exportado!", "success");
    }
}

// Funções do Histórico
function addToHistory(result, originalText) {
    const historyItem = {
        id: Date.now(),
        timestamp: new Date().toLocaleString("pt-BR"),
        classificacao: result.classificacao || "Erro",
        justificativa: result.justificativa || "",
        confianca: result.confianca || 0,
        preview: originalText.substring(0, 100),
        fullResult: result,
    };
    classificationHistory.unshift(historyItem);
    if (classificationHistory.length > 10) {
        classificationHistory = classificationHistory.slice(0, 10);
    }
    saveHistory();
    renderHistory();
}

function renderHistory() {
    if (classificationHistory.length === 0) {
        historyContainer.innerHTML = '<p class="empty-history">Nenhuma classificação realizada ainda.</p>';
        return;
    }
    historyContainer.innerHTML = classificationHistory.map(item => {
        const classificacao = item.classificacao || "Erro";
        const isProdutivo = classificacao.toLowerCase().includes("produtivo") && !classificacao.toLowerCase().includes("não");
        const classType = isProdutivo ? "produtivo" : "nao-produtivo";
        return `
            <div class="history-item" data-id="${item.id}" onclick="loadHistoryItem(${item.id})">
                <div class="history-meta">
                    <span class="history-classification history-${classType}">${isProdutivo ? "Produtivo" : "Não Produtivo"}</span>
                    <span class="history-timestamp">${item.timestamp}</span>
                </div>
                <p class="history-preview">${item.preview}...</p>
                <em class="history-justificativa">${(item.justificativa || "").substring(0, 80)}...</em>
            </div>
        `;
    }).join('');
}

function loadHistoryItem(id) {
    const item = classificationHistory.find(h => h.id === Number(id));
    if (item) {
        showResponse(item.fullResult);
        showToast("Item do histórico carregado!", "info");
        document.querySelector('.response-section').scrollIntoView({ behavior: 'smooth' });
    } else {
        showToast("Erro ao carregar item do histórico", "error");
    }
}

function clearHistory() {
    if (confirm("Tem certeza que deseja limpar todo o histórico?")) {
        classificationHistory = [];
        saveHistory();
        renderHistory();
        showToast("Histórico limpo!", "info");
    }
}

function saveHistory() {
    try {
        sessionStorage.setItem('emailClassificationHistory', JSON.stringify(classificationHistory));
    } catch (e) {
        console.warn("Não foi possível salvar histórico:", e);
    }
}

function loadHistory() {
    try {
        const saved = sessionStorage.getItem('emailClassificationHistory');
        if (saved) {
            classificationHistory = JSON.parse(saved);
            renderHistory();
        }
    } catch (e) {
        console.warn("Não foi possível carregar histórico:", e);
        classificationHistory = [];
    }
}

// Funções de Estatísticas
function updateStats() {
    totalProcessedSpan.textContent = stats.total;
    successRateSpan.textContent = stats.total > 0 ? `${((stats.successful / stats.total) * 100).toFixed(1)}%` : "-";
    saveStats();
}

function saveStats() {
    try {
        sessionStorage.setItem('emailClassificationStats', JSON.stringify(stats));
    } catch (e) {
        console.warn("Não foi possível salvar estatísticas:", e);
    }
}

function loadStats() {
    try {
        const saved = sessionStorage.getItem('emailClassificationStats');
        if (saved) {
            stats = JSON.parse(saved);
            updateStats();
        }
    } catch (e) {
        console.warn("Não foi possível carregar estatísticas:", e);
    }
}