#!/usr/bin/env python3
import html
import json
import re
import requests

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"}
urls = [
    "https://store.steampowered.com/app/3875050/MotoGP26/?l=english&cc=us&agecheckage=1-January-1990",
    "https://store.steampowered.com/app/3875050/MotoGP_26/?l=english&cc=us&agecheckage=1-January-1990",
    "https://store.steampowered.com/api/appdetails?appids=3875050&cc=us&l=english",
]
for url in urls:
    print("\n===", url, "===")
    r = requests.get(url, headers=UA, timeout=60, allow_redirects=True)
    print("status", r.status_code, "final", r.url, "length", len(r.content), "type", r.headers.get("content-type"))
    text = html.unescape(r.text).replace("\\/", "/")
    if "api/appdetails" in url:
        try:
            payload = r.json()
            data = payload.get("3875050", {}).get("data", {})
            print("DATA KEYS", sorted(data.keys()))
            print("MOVIES", json.dumps(data.get("movies"), indent=2)[:20000])
            print("SCREENSHOTS", len(data.get("screenshots", [])))
        except Exception as e:
            print("JSON ERROR", e, text[:500])
        continue
    patterns = [
        r'https?://[^\s\"\'<>]+?\.(?:mp4|webm)(?:\?[^\s\"\'<>]*)?',
        r'"(?:movie_max|movie_480p|webm_source|mp4_source|data-webm-source|data-mp4-source)"\s*[:=]\s*"([^"]+)"',
        r'data-(?:webm|mp4)-source="([^"]+)"',
    ]
    found=[]
    for pat in patterns:
        for m in re.findall(pat, text, re.I):
            if isinstance(m, tuple):
                m=next((x for x in m if x), "")
            if m and m not in found:
                found.append(m)
    print("MEDIA URL COUNT", len(found))
    for item in found:
        print("MEDIA", item)
    for token in ["highlight_movie", "movie_max", "movie_480p", "microtrailer", "store_trailers", "data-webm-source", "data-mp4-source"]:
        pos=text.lower().find(token.lower())
        if pos>=0:
            print("CONTEXT", token, text[max(0,pos-500):pos+1500].replace("\n"," "))
