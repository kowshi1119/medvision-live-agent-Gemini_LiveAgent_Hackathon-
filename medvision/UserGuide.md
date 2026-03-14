# MedVision User Guide

This guide provides instructions on how to use the MedVision application, a real-time multimodal emergency medical agent.

## 1. Starting a Session

1.  **Language Selection**: Before starting, choose your preferred language from the dropdown menu in the top right corner. The agent will respond in the selected language.
2.  **Start Session**: Click the "START SESSION" button. The application will connect to the Gemini Live agent.
3.  **Permissions**: Your browser will ask for permission to use your camera and microphone. Please allow access for the agent to see and hear the situation.

## 2. During a Session

Once the session is active, you will see:

*   **Patient View**: A live feed from your camera. A "LIVE" indicator will be visible.
*   **Agent Response**:
    *   **Voice Activity**: Animated bars will show when the agent is speaking.
    *   **Live Transcript**: A real-time transcript of the agent's guidance will appear.
*   **Triage Cards**: As the agent assesses the situation, it will generate structured triage cards with recommended actions. These are based on WHO protocols.
*   **Session Log**: A detailed log of all events during the session is available on the right.

### Interrupting the Agent

If you need to speak or interrupt the agent, click the **INTERRUPT** button at any time. This will immediately stop the agent from speaking, allowing you to provide new information.

## 3. Ending a Session

1.  **End Session**: Click the "END SESSION" button to disconnect from the agent.
2.  **Download Report**: After the session, you can click "DOWNLOAD REPORT" to save a JSON file containing the full session transcript, all triage cards, and event logs.

## 4. Troubleshooting

*   **Connection Issues**: If the connection status shows "Error" or "Reconnecting", check your internet connection and ensure the Cloud Run URL is correct.
*   **No Camera/Microphone**: If you accidentally denied permissions, you may need to reset them in your browser's site settings for this page.
*   **Agent Not Responding**: Ensure your microphone is not muted and that you are speaking clearly. You can use the "INTERRUPT" button to restart the agent's listening.
