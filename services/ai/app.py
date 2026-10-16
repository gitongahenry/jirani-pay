"""Optional open-model service for Jirani Pay (Hugging Face).

Endpoints
  POST /explain  {lang, facts}  -> {text}   short Swahili/English explanation of a *computed* recommendation
  POST /tts      {text}         -> audio/wav Swahili speech
  GET  /health

The model never decides prices, totals or approvals. The API computes those from the catalogue and
rejects any generated sentence that contains a number it did not supply (see services/api/src/assistant.js).

Models are chosen with env vars. VERIFY EACH MODEL'S LICENSE ON ITS HUGGING FACE PAGE before you deploy:
  LLM_MODEL  default mwitiderrick/SwahiliInstruct-v0.2  (Mistral-7B-Instruct-v0.2 fine-tuned on Swahili Alpaca)
  TTS_MODEL  default facebook/mms-tts-swh               (MMS is published under CC-BY-NC; non-commercial)
"""
import io
import os
import threading

import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer, VitsModel

LLM_MODEL = os.getenv("LLM_MODEL", "mwitiderrick/SwahiliInstruct-v0.2")
TTS_MODEL = os.getenv("TTS_MODEL", "facebook/mms-tts-swh")
ENABLE_LLM = os.getenv("ENABLE_LLM", "1") == "1"
ENABLE_TTS = os.getenv("ENABLE_TTS", "1") == "1"

app = FastAPI(title="Jirani AI service")
_lock = threading.Lock()
_llm = {}
_tts = {}


def llm():
    if not _llm:
        tok = AutoTokenizer.from_pretrained(LLM_MODEL)
        model = AutoModelForCausalLM.from_pretrained(LLM_MODEL, torch_dtype="auto", device_map="auto")
        _llm.update(tok=tok, model=model)
    return _llm["tok"], _llm["model"]


def tts():
    if not _tts:
        _tts.update(tok=AutoTokenizer.from_pretrained(TTS_MODEL), model=VitsModel.from_pretrained(TTS_MODEL))
    return _tts["tok"], _tts["model"]


class ExplainIn(BaseModel):
    lang: str = "sw"
    facts: dict


class TtsIn(BaseModel):
    text: str


@app.get("/health")
def health():
    return {"ok": True, "llm": LLM_MODEL if ENABLE_LLM else None, "tts": TTS_MODEL if ENABLE_TTS else None}


@app.post("/explain")
def explain(body: ExplainIn):
    if not ENABLE_LLM:
        raise HTTPException(501, "LLM disabled")
    r = body.facts.get("recommended", {})
    lang = "Kiswahili" if body.lang == "sw" else "English"
    name = r.get("name_sw") if body.lang == "sw" else r.get("name_en")
    prompt = (
        f"[INST] Andika sentensi 2 fupi kwa {lang} kumweleza mkulima pendekezo hili. "
        f"Tumia namba hizi pekee, usibuni namba nyingine: bidhaa={name}, msambazaji={r.get('supplier')}, "
        f"bei={r.get('unitPriceKes')}, jumla={r.get('totalKes')}, siku_za_uwasilishaji={r.get('deliveryDays')}, "
        f"bajeti={body.facts.get('budget')}, itabaki={body.facts.get('remaining')}. [/INST]"
    )
    tok, model = llm()
    with _lock:
        ids = tok(prompt, return_tensors="pt").to(model.device)
        out = model.generate(**ids, max_new_tokens=90, do_sample=False, repetition_penalty=1.1)
    text = tok.decode(out[0][ids["input_ids"].shape[1]:], skip_special_tokens=True).strip()
    return {"text": text, "model": LLM_MODEL}


@app.post("/tts")
def speak(body: TtsIn):
    if not ENABLE_TTS:
        raise HTTPException(501, "TTS disabled")
    import scipy.io.wavfile as wav

    tok, model = tts()
    with _lock, torch.no_grad():
        wave = model(**tok(body.text[:400], return_tensors="pt")).waveform[0].numpy()
    buf = io.BytesIO()
    wav.write(buf, model.config.sampling_rate, wave)
    return Response(buf.getvalue(), media_type="audio/wav")
