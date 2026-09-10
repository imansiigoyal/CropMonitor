# 🚀 How to Deploy CropMonitor AI to Streamlit Community Cloud

You can deploy **CropMonitor AI** for free to **[Streamlit Community Cloud](https://streamlit.io/cloud)** so that anyone can access your smart farming dashboard and AgriBot AI assistant online with a public URL!

---

## 📋 Prerequisites
1. A free GitHub account ([github.com](https://github.com))
2. A free Google Gemini API Key ([aistudio.google.com](https://aistudio.google.com))

---

## ⚡ Instant 1-Click Streamlit Cloud Deploy Link

Click this link directly to deploy this repository on Streamlit Cloud in seconds:
👉 **[Click Here to 1-Click Deploy on Streamlit Cloud](https://share.streamlit.io/deploy?repository=imansiigoyal/CropMonitor&branch=main&mainModule=streamlit_app.py)**

---

## 📋 Direct App Details
- **GitHub Repository**: [https://github.com/imansiigoyal/CropMonitor](https://github.com/imansiigoyal/CropMonitor)
- **Branch**: `main`
- **Main file path**: `streamlit_app.py`
- **One-Click Deploy URL**: `https://share.streamlit.io/deploy?repository=imansiigoyal/CropMonitor&branch=main&mainModule=streamlit_app.py`

---

## Step 1: Deploy on Streamlit Cloud
1. Click the 1-click deploy link above (or visit **[share.streamlit.io](https://share.streamlit.io)**).
2. Confirm the repository settings:
   - **Repository**: `imansiigoyal/CropMonitor`
   - **Branch**: `main`
   - **Main file path**: `streamlit_app.py`

---

## Step 3: Add Your Gemini API Key in Secrets

In the **Secrets** box, paste:

```toml
GEMINI_API_KEY = "your_actual_gemini_api_key_here"
```

> 🔒 **Security Note**: Never commit your raw API key to public GitHub commits. Streamlit Cloud's Secrets manager securely injects it into your app at runtime.

---

## Step 4: Click Deploy!

Click **Deploy**! 
Streamlit Cloud will install dependencies from `requirements.txt` and launch your live application at a custom URL (e.g. `https://cropmonitor-ai.streamlit.app`).

---

## 💻 Running Locally Anytime

You can also run your Streamlit application locally on your machine whenever you want:

```powershell
cd C:\Users\hp\Desktop\CropMonitor
python -m streamlit run streamlit_app.py
```

Your app will launch immediately at: **http://localhost:8501**
