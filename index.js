const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config(); // Load environment variables from .env

class LangflowClient {
    constructor(baseURL, applicationToken) {
        this.baseURL = baseURL;
        this.applicationToken = applicationToken;
    }

    async post(endpoint, body, headers = { "Content-Type": "application/json" }) {
        headers["Authorization"] = `Bearer ${this.applicationToken}`;
        const url = `${this.baseURL}${endpoint}`;
        try {
            const response = await axios.post(url, body, { headers });
            return response.data;
        } catch (error) {
            console.error('Request Error:', error.message);
            throw new Error(`${error.response.status} ${error.response.statusText} - ${JSON.stringify(error.response.data)}`);
        }
    }

    async initiateSession(flowId, langflowId, inputValue, inputType = 'chat', outputType = 'chat', stream = false, tweaks = {}) {
        const endpoint = `/lf/${langflowId}/api/v1/run/${flowId}?stream=${stream}`;
        return this.post(endpoint, { input_value: inputValue, input_type: inputType, output_type: outputType, tweaks: tweaks });
    }

    handleStream(streamUrl, onUpdate, onClose, onError) {
        const eventSource = new EventSource(streamUrl);

        eventSource.onmessage = event => {
            const data = JSON.parse(event.data);
            onUpdate(data);
        };

        eventSource.onerror = event => {
            console.error('Stream Error:', event);
            onError(event);
            eventSource.close();
        };

        eventSource.addEventListener("close", () => {
            onClose('Stream closed');
            eventSource.close();
        });

        return eventSource;
    }

    async runFlow(flowIdOrName, langflowId, inputValue, inputType = 'chat', outputType = 'chat', tweaks = {}, stream = false, onUpdate, onClose, onError) {
        try {
            const initResponse = await this.initiateSession(flowIdOrName, langflowId, inputValue, inputType, outputType, stream, tweaks);
            console.log('Init Response:', initResponse);
            if (stream && initResponse && initResponse.outputs && initResponse.outputs[0].outputs[0].artifacts.stream_url) {
                const streamUrl = initResponse.outputs[0].outputs[0].artifacts.stream_url;
                console.log(`Streaming from: ${streamUrl}`);
                this.handleStream(streamUrl, onUpdate, onClose, onError);
            }
            return initResponse;
        } catch (error) {
            console.error('Error running flow:', error);
            onError('Error initiating session');
        }
    }
}

const app = express();
const port = 3000;
app.use(cors());
app.use(bodyParser.json());

app.post('/run-flow', async (req, res) => {
    const { inputValue, inputType = 'chat', outputType = 'chat', stream = false } = req.body;

    if (!inputValue) {
        return res.status(400).json({ error: 'inputValue is required' });
    }

    try {
        const flowIdOrName = process.env.FLOW_ID;
        const langflowId = process.env.LANGFLOW_ID;
        const applicationToken = process.env.APPLICATION_TOKEN;
        
        const langflowClient = new LangflowClient(
            process.env.LANGFLOW_BASE_URL,
            applicationToken
        );

        const tweaks = {
            "ChatInput-ak1ID": {},
            "ParseData-rkrt9": {},
            "Prompt-I7VVj": {},
            "ChatOutput-Sq2OG": {},
            "AstraDB-bSWeq": {},
            "Agent-mUStn": {},
            "GroqModel-4QBfY": {},
            "SplitText-CjTdi": {},
            "File-iOPsi": {}
        };

        const response = await langflowClient.runFlow(
            flowIdOrName,
            langflowId,
            inputValue,
            inputType,
            outputType,
            tweaks,
            stream,
            (data) => console.log("Received:", data.chunk), // onUpdate
            (message) => console.log("Stream Closed:", message), // onClose
            (error) => console.log("Stream Error:", error) // onError
        );

        if (!stream && response && response.outputs) {
            const flowOutputs = response.outputs[0];
            const firstComponentOutputs = flowOutputs.outputs[0];
            const output = firstComponentOutputs.outputs.message;

            return res.json({ success: true, output: output.message.text });
        } else {
            return res.json({ success: true, message: "Stream initiated" });
        }
    } catch (error) {
        console.error('Error in /run-flow:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
