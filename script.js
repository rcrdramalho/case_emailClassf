document.getElementById("uploadForm").addEventListener("submit", async function(e) {
    e.preventDefault();

    const fileInput = document.getElementById("file");
    const textInput = document.getElementById("text").value.trim();
    let bodyData = {};

    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const reader = new FileReader();

        reader.onload = async function() {
            let base64String;

            if (file.type === "application/pdf" || file.type === "text/plain") {
                const bytes = new Uint8Array(reader.result);
                base64String = btoa(String.fromCharCode(...bytes));

                bodyData = {
                    body: base64String,
                    isBase64Encoded: true
                };

                await enviarParaLambda(bodyData);
            } else {
                document.getElementById("resposta").textContent = "Tipo de arquivo não suportado.";
            }
        };

        reader.readAsArrayBuffer(file);

    } else if (textInput.length > 0) {
        bodyData = {
            body: textInput,
            isBase64Encoded: false
        };

        await enviarParaLambda(bodyData);

    } else {
        document.getElementById("resposta").textContent = "Por favor, insira texto ou selecione um arquivo.";
    }
});

async function enviarParaLambda(bodyData) {
    try {
        // Proxy temporário para contornar CORS
        const proxyUrl = "https://cors-anywhere.herokuapp.com/";
        const lambdaUrl = "https://kcp02bv6wa.execute-api.sa-east-1.amazonaws.com/cases";
        const fullUrl = proxyUrl + lambdaUrl;

        console.log("URL da requisição:", fullUrl);
        console.log("Body enviado:", JSON.stringify(bodyData));

        const response = await fetch(fullUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyData)
        });

        const resData = await response.json();

        let lambdaBody;
        try {
            lambdaBody = JSON.parse(resData.body);
        } catch {
            lambdaBody = resData.body;
        }

        document.getElementById("resposta").textContent = JSON.stringify(lambdaBody, null, 2);

    } catch (err) {
        document.getElementById("resposta").textContent = "Erro: " + err;
        console.error(err);
    }
}
