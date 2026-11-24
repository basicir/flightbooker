# Az OurAirports airports.csv és runways.csv fájljából készíti a src/core/airports/data.ts tartalmát.
# Használat: python3 -I tools/airports/build_airports.py <a két CSV mappája> <kimenet.json>
# A CSV-k forrása: https://davidmegginson.github.io/ourairports-data/ (közkincs).
import csv, json, math, re, sys
src, out = sys.argv[1], sys.argv[2]
DES = re.compile(r'^(0[1-9]|[12]\d|3[0-6])[LCR]?$')
ICAO = re.compile(r'^[A-Z]{4}$')
airports = {}
ref_to_icao = {}
with open(f'{src}/airports.csv', newline='', encoding='utf-8') as f:
    for r in csv.DictReader(f):
        if r['type'] not in ('large_airport', 'medium_airport', 'small_airport'):
            continue
        code = next((c for c in (r['icao_code'], r['gps_code'], r['ident']) if ICAO.match(c or '')), None)
        if not code or code in airports:
            continue
        try:
            lat, lon = float(r['latitude_deg']), float(r['longitude_deg'])
        except ValueError:
            continue
        airports[code] = [round(lat, 4), round(lon, 4), []]
        ref_to_icao[r['id']] = code

def bearing(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360

def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

with open(f'{src}/runways.csv', newline='', encoding='utf-8') as f:
    for r in csv.DictReader(f):
        code = ref_to_icao.get(r['airport_ref'])
        if not code or r['closed'] == '1':
            continue
        le, he = (r['le_ident'] or '').strip().upper(), (r['he_ident'] or '').strip().upper()
        if not DES.match(le) or not DES.match(he):
            continue
        lh, hh = num(r['le_heading_degT']), num(r['he_heading_degT'])
        if lh is None:
            c = [num(r[k]) for k in ('le_latitude_deg', 'le_longitude_deg', 'he_latitude_deg', 'he_longitude_deg')]
            if None not in c:
                lh = bearing(*c)
        if lh is not None and hh is None:
            hh = (lh + 180) % 360
        rw = airports[code][2]
        for d, h in ((le, lh), (he, hh)):
            if not any(x[0] == d for x in rw):
                rw.append([d, None if h is None else round(h % 360, 1)])
for v in airports.values():
    if not v[2]:
        v.pop()
with open(out, 'w', encoding='utf-8') as f:
    json.dump(dict(sorted(airports.items())), f, separators=(',', ':'))
print(len(airports), sum(1 for v in airports.values() if len(v) > 2))
print('LHNY', airports.get('LHNY'), 'LHBP', airports.get('LHBP'), 'LHDK', airports.get('LHDK'))
