# FreeVisualizer

Vizualizator 3D **gratuit** pentru **SoundSwitch**, în stilul Capture, dar mai simplu. Adaugi fixturile din rigul tău (moving heads, par-uri, retro-uri, bare LED, strobe, scântei reci, fum greu, glob disco, laser), le așezi pe truss sau pe podea și vezi show-ul în timp real, cu fascicule în haze, glow și lumină pe pereți. Poți înregistra apoi clipuri video cu logo-ul tău, pentru Instagram, TikTok sau oferte.

Rulează ca **aplicație pe Mac** (Apple Silicon și Intel) sau pe Windows, ori direct în browser cu Node.js.

Funcționează cu orice software care trimite **Art-Net** sau **sACN (E1.31)**: SoundSwitch, rekordbox lighting, QLC+, Lightjams, grandMA onPC etc.

## Ce știe să facă

- **Primește DMX live** prin Art-Net (UDP 6454) și sACN (UDP 5568). Răspunde la ArtPoll, așa că SoundSwitch îl găsește ca nod Art-Net cu numele „FreeVisualizer”.
- **Scenă 3D** cu fascicule volumetrice, haze reglabil, bloom/glow, lumină reală pe podea, pereți și invitați, plus camere rapide (3D, Față, Sus, Lateral, din cabina DJ, din public).
- **Fixturi**:
  - par/uplight RGB, RGBW, RGBWA+UV
  - moving head Spot, Beam și Wash, cu pan/tilt pe 16 biți, roată de culori, gobo, prismă și zoom
  - bare LED cu pixeli
  - **retro hexagonal cu 7 capete** (1 în centru + 6 în jur): bec cald cu filament care se aprinde și se stinge ca un bec adevărat, sau varianta RGB
  - stroboscop, blinder
  - mașină de fum, care chiar îngroașă haze-ul din sală
- **Efecte de nuntă**:
  - mașini de **scântei reci** (sparkulare), cu înălțime controlată din DMX
  - **fum greu / „dans în nori”**, un nor jos care se întinde pe ring și ia culoarea luminilor
  - **glob disco** cu pinspot-uri: reflexiile se rotesc pe pereți, tavan și invitați
  - **laser** cu 5 modele (evantai, liquid sky, con, tunel, rază)
- **Clipuri video pentru clienți**: înregistrezi show-ul în format vertical 9:16 (Reels/TikTok), 16:9 sau 1:1, cu logo-ul și textul tău, cameră cinematică automată și, opțional, melodia ta
- **Șabloane**: „Rig nuntă” (cabină DJ cu truss, retro-uri, 12 uplight-uri, ring de dans cu scântei, glob, fum greu, laser, masa mirilor, mese rotunde) și „Rig club"
- **Bibliotecă**: profile generice incluse, căutare și import direct din [Open Fixture Library](https://open-fixture-library.org) (peste o mie de modele Chauvet, ADJ, Cameo, Stairville, Eurolite, Showtec etc.) și un editor pentru profilele tale.
- **Scenă**: truss, stâlpi, cabină DJ, boxe, subwoofere, podium, ring de dans, ecran LED, pereți, masa mirilor, mese rotunde și public animat.
- **Patch**:
  - univers și adresă pentru fiecare fixtură
  - adresa următoare liberă se completează automat
  - suprapunerile de adrese sunt semnalate
  - monitor DMX cu cele 512 canale ale fiecărui univers
- **Test fără SoundSwitch**:
  - butonul **▶ Demo** pornește un show intern pe 126 BPM, cu culori, mișcare, strobe, scântei, fum greu și laser
  - din inspector poți comanda manual canalele fixturii selectate (faderele „Test canale” și butonul **Găsește**)
- **Proiecte**:
  - salvare automată în browser
  - salvare pe calculator (Ctrl+S)
  - export și import ca fișier `.json`
  - Undo/Redo
- Merge **fără internet** (Three.js e inclus). Internetul trebuie doar ca să imporți fixturi din Open Fixture Library.

## Instalare pe Mac (recomandat)

1. Descarcă `FreeVisualizer-…-mac.dmg` de la **Releases** pe GitHub. Fiecare versiune nouă se construiește automat și în **Actions → ultimul build → Artifacts**.
2. Deschide `.dmg`-ul și trage **FreeVisualizer** în **Applications**.
3. **Prima pornire**. Aplicația nu e semnată cu un cont Apple Developer, așa că macOS o blochează o dată:
   - click dreapta pe FreeVisualizer → **Deschide** → **Deschide**;
   - pe macOS 15 sau mai nou: dacă tot apare blocată, mergi la **Setări sistem → Confidențialitate și securitate**, derulează până jos și apasă **Deschide oricum**.
4. Când macOS te întreabă de **Rețea locală**, apasă **Permite**. Fără permisiunea asta nu primești Art-Net de la alt calculator.

Aplicația pornește singură serverul, așa că nu ai nevoie de Node.js sau de terminal. Proiectele se salvează în `~/Library/Application Support/FreeVisualizer` (meniul **Ajutor → Folderul cu date**).

Din meniul **Vizualizare → Fereastră de prezentare** (Cmd+P) deschizi show-ul pe tot ecranul, pe al doilea monitor.

> Dacă vrei aplicația semnată (fără avertismentul de la prima pornire), adaugă în GitHub → Settings → Secrets: `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Ai nevoie de un cont Apple Developer, care costă 99 $/an. Build-ul o va semna și notariza automat.

## Instalare pe Windows

Descarcă `FreeVisualizer-…-windows-setup.exe` de la Releases și rulează-l.

## Varianta fără instalare (browser + Node.js)

1. Instalează **Node.js LTS** (gratuit) de pe <https://nodejs.org>.
2. Descarcă proiectul: butonul verde **Code → Download ZIP** pe GitHub, apoi dezarhivează-l.

Pentru rulare nu trebuie instalat nimic altceva.

Pornire:

- **Windows:** dublu-click pe `start-windows.bat`
- **macOS:** dublu-click pe `start-mac.command`. Prima dată: click dreapta → Open, ca să treacă de Gatekeeper.
- **Din terminal:** `npm start` (sau `node server/index.js`)

Se deschide automat <http://localhost:8080>. Fereastra neagră a serverului trebuie să rămână deschisă cât timp folosești vizualizatorul.

## Conectare cu SoundSwitch

### Pe același laptop

1. Pornește **întâi FreeVisualizer**, apoi SoundSwitch.
2. În SoundSwitch: **Preferences → Hardware**, bifează **Localhost Art-Net Node** (opțiune disponibilă din SoundSwitch 2.9).
3. În FreeVisualizer adaugă **aceleași fixturi**, cu **același univers, aceeași adresă și același mod DMX** ca în DMX Patch-ul din SoundSwitch.
4. Indicatorul din dreapta sus devine verde („Primesc DMX”). Pune muzică!

### Pe alt calculator din rețea

- Conectează ambele calculatoare la aceeași rețea, de preferat prin cablu. Multe routere Wi‑Fi blochează Art-Net.
- În SoundSwitch alege nodul Art-Net „FreeVisualizer” sau IP-ul calculatorului pe care rulează vizualizatorul. IP-ul îl găsești în **⚙ Setări**.
- Permite Node.js în firewall pentru porturile UDP **6454** (Art-Net) și **5568** (sACN).

### Numerotarea universurilor

Implicit, universul Art-Net 0 apare în vizualizator ca **Universul 1**, la fel ca în SoundSwitch. Dacă software-ul tău numerotează altfel, schimbă setarea din **⚙ Setări**. În tab-ul **DMX** vezi exact ce universuri sosesc.

## Cum îmi fac rigul

1. **Nou → Rig nuntă** îți dă un punct de plecare complet. Îl adaptezi la sala ta.
2. **Fixturi → + Adaugă fixturi**: alegi profilul, cantitatea, universul și adresa de start, apoi montajul (pe podea, agățat pe truss, spre public). Retro-urile sunt profilele „Retro hexagonal 7 capete”, în 4 variante de canale.
3. Dacă modelul tău nu e în lista generică: **Bibliotecă → Caută online (OFL)**, scrii numele (de exemplu „intimidator spot 260”) și alegi **exact modul DMX** setat pe fixtură. Profilul rămâne salvat în proiect.
4. Click pe o fixtură în scenă ca s-o selectezi. Apoi:
   - **W** sau **E** comută între mutare și rotire cu gizmo-ul
   - poziția și rotația se pot scrie și exact în inspector
5. **Scenă**: adaugi truss, cabină DJ, boxe, ecran LED și invitați, și setezi dimensiunile sălii.
6. **Ctrl+S** salvează proiectul. Cu **Export** iei fișierul `.json` și îl poți muta pe alt laptop.

### Scurtături

| Tastă | Acțiune |
| --- | --- |
| W / E | Mută / rotește selecția |
| F | Centrează camera pe selecție |
| Ctrl+D | Duplică (cu adresa următoare) |
| Del | Șterge |
| Ctrl+Z / Ctrl+Y | Anulează / refă |
| Ctrl+S | Salvează |
| H | Ascunde panourile (mod prezentare, ideal pe al doilea monitor) |
| D | Pornește/oprește demo |
| L | Etichete cu nume și adrese |
| 1–6 | Camere: 3D, față, sus, lateral, DJ, public |

## Clipuri video pentru clienți

1. **⚙ Setări → Branding**: scrii numele și site-ul (sau Instagram-ul) și încarci logo-ul, de preferat PNG transparent.
2. Apasă **● Clip** în bara de sus a scenei.
3. Alegi formatul (9:16 pentru Reels/TikTok, 16:9 sau 1:1), durata (15/30/60 s), camera cinematică și, opțional, o melodie și un text (de exemplu „Nuntă Ana & Mihai · Salon Diamond”).
4. Clipul se salvează ca **.mp4** în aplicația de Mac, în Chrome și în Edge.

Ai două surse pentru show:
- cu SoundSwitch pornit, debifezi Demo și înregistrezi show-ul real, pe melodia care rulează;
- fără SoundSwitch, folosești Demo-ul intern.

## Probleme frecvente

- **„Nu primesc date DMX”**: verifică dacă e bifat *Localhost Art-Net Node* și repornește SoundSwitch *după* ce ai pornit FreeVisualizer.
- **„Portul 6454 e ocupat”**: un alt vizualizator (de exemplu Capture) sau o altă instanță ascultă deja pe port. Închide-l și pornește din nou.
- **Culori sau mișcări greșite**: modul DMX (numărul de canale) diferă între profil și SoundSwitch. Verifică fiecare canal cu faderele „Test canale”.
- **Moving head-ul se mișcă invers**: bifează „Inversează pan” sau „Inversează tilt” în inspector.

## Pentru dezvoltatori

```
server/            Node.js fără dependențe: Art-Net, sACN, SSE către browser, proxy OFL, proiecte
desktop/           aplicația Electron (Mac/Windows): fereastră, meniu, fereastră de prezentare
.github/workflows/ build automat .dmg (universal) + .exe; Release la fiecare tag v*
public/js/         aplicația (ES modules, Three.js r170 inclus în public/vendor)
  fixture-state.js DMX → culoare/intensitate/pan/tilt (pur, testat)
  ofl-import.js    Open Fixture Library → profil FreeVisualizer (pur, testat)
  fixtures3d.js    modelele 3D și fasciculele
  scene3d.js       scena, camera, bloom, selecție
  particles.js     particule (scântei, fum greu, reflexii glob)
  recorder.js      înregistrare clipuri video
tools/send-test-artnet.js   trimite un semnal Art-Net de test
test/              teste (npm test)
```

- `npm test` rulează testele (parsere Art-Net/sACN, ArtPoll, import OFL, logica DMX).
- `npm run test-signal` trimite un curcubeu Art-Net către vizualizator, fără SoundSwitch.
- `npm install && npm run app` pornește aplicația desktop din cod.
- `npm run dist:mac` construiește `.dmg`-ul; merge doar pe un Mac, altfel îl face GitHub Actions.

Licență: MIT. Three.js este distribuit sub licența MIT (vezi `public/vendor/three/LICENSE`). Datele Open Fixture Library sunt sub licența MIT.
