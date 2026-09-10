# 🚀 How to Deploy CropMonitor AI to Streamlit Community Cloud

You can deploy **CropMonitor AI** for free to **[Streamlit Community Cloud](https://streamlit.io/cloud)** so that anyone can access your smart farming dashboard and AgriBot AI assistant online with a public URL!

---

## 📋 Prerequisites
1. A free GitHub account ([github.com](https://github.com))
2. A free Google Gemini API Key ([aistudio.google.com](https://aistudio.google.com))

---

## Step 1: Push Your Code to GitHub

Open PowerShell in `CropMonitor`:

```powershell
cd C:\Users\hp\Desktop\CropMonitor

# Initialize git if not already done
git init
git add .
git commit -m "Add CropMonitor AI Streamlit app with AgriBot and Vision"

# Create a new public/private repository on GitHub, then link it:
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/CropMonitor.git
git branch -M main
git push -u origin main
```

---

## Step 2: Deploy on Streamlit Cloud

1. Go to **[share.streamlit.io](https://share.streamlit.io)** and log in with your GitHub account.
2. Click **New app**.
3. Select your repository:
   - **Repository**: `YOUR_GITHUB_USERNAME/CropMonitor`
   - **Branch**: `main`
   - **Main file path**: `streamlit_app.py`
4. Click **Advanced settings** (or the **Secrets** section).

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
