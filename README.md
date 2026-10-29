# FreeVisualizer

Vizualizator 3D pentru **SoundSwitch**, în stilul Capture, dar mai simplu. Adaugi fixturile din rigul tău (moving heads, par-uri, retro-uri, bare LED, strobe, scântei reci, fum greu, glob disco, laser), le așezi pe truss sau pe podea și vezi show-ul în timp real, cu fascicule în haze, glow și lumină pe pereți. Poți înregistra apoi clipuri video cu logo-ul tău, pentru Instagram, TikTok sau oferte.

Rulează ca **aplicație pe Mac** (Apple Silicon și Intel) și pe Windows. Interfața e în **română sau engleză**, la alegere (**[English below](#english)**).

Funcționează cu orice software care trimite **Art-Net** sau **sACN (E1.31)**: SoundSwitch, rekordbox lighting, QLC+, Lightjams, grandMA onPC etc.

## Ce știe să facă

- **Primește DMX live** prin Art-Net (UDP 6454) și sACN (UDP 5568). Răspunde la ArtPoll, așa că SoundSwitch îl găsește ca nod Art-Net cu numele „FreeVisualizer”.
- **Scenă 3D** cu fascicule volumetrice, haze reglabil, bloom/glow, lumină reală pe podea, pereți și invitați, plus camere rapide (3D, Față, Sus, Lateral, din cabina DJ, din public).
- **Fixturi care arată ca aparatele reale** (display, lentile, grile de ventilație, LED-uri vizibile, materiale de metal, plastic și sticlă):
  - par/uplight RGB, RGBW, RGBWA+UV (plat cu bracket, par can sau pinspot)
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
- **Modele 3D reale**: fișierele **GDTF** își aduc modelul 3D al producătorului (bază, braț și cap care se mișcă pe pan/tilt) și poza aparatului. Poți încărca și un model **.glb** în profilul fixturii (**🔍 Poze cu aparatul** caută imagini după model).
- **Aparatele tale arată ca în realitate**, la dimensiunile reale, direct la importul din SoundSwitch: BeamZ Panther 60 (model 3D inclus), Chauvet Intimidator Spot LED 250, UKing ZQ01104 (fiecare LED roșu / verde / albastru se aprinde în culoarea lui), retro-ul „7 Vintage” (inel RGB + filament alb cald pe fiecare cap, mărimea se reglează din profil) și hazer-ul ADJ Entour Faze (haze-ul iese din duză).
- **Sală realistă**: **sală de evenimente** (parchet, lambriu, ferestre cu draperii, tavan casetat, candelabre, draperie albă în spatele DJ-ului), **sală goală** sau **club (întunecat)**. Slider-ul **Sală** aprinde candelabrele și luminează ambientul; **💡** dă lumină de lucru.
- **✨ Asistent Claude**: îi scrii ce vrei („Pune 4 BeamZ Panther 60 pe truss de la adresa 200”) și adaugă, așază, mută sau șterge fixturi, cu cheia ta API de la Anthropic.
- **Clipuri video pentru clienți**: înregistrezi show-ul în format vertical 9:16 (Reels/TikTok), 16:9 sau 1:1, cu logo-ul și textul tău, cameră cinematică automată și, opțional, melodia ta
- **Șabloane**: „Rig nuntă” (cabină DJ cu truss, retro-uri, 12 uplight-uri, ring de dans cu scântei, glob, fum greu, laser, masa mirilor, mese rotunde) și „Rig club"
- **Import direct din SoundSwitch**: citește proiectul `.ssproj` și pune în scenă aceleași fixturi, cu aceleași nume, moduri și adrese ca în DMX Map, cu profilele din SoundSwitch
- **Bibliotecă**:
  - profile generice incluse
  - **o singură căutare** în „Adaugă fixturi”: profilele tale, [Open Fixture Library](https://open-fixture-library.org) (Chauvet, ADJ, Cameo, BeamZ, Stairville, Eurolite, Showtec etc., import direct) și un buton spre [Fixture.ID](https://www.fixture.id/)
  - import de fișiere **.d4** de pe Fixture.ID (format Avolites), plus **.gdtf**, **.zip** și **.json**: le tragi peste fereastră și gata
  - în aplicația pentru Mac / Windows, Fixture.ID se deschide într-o fereastră proprie, iar fișierul descărcat se importă singur
  - editor pentru profilele tale
- **Editare rapidă**:
  - **plasare cu mouse-ul**: click pe truss, podea sau perete și fixtura se pune singură cu lumina în direcția corectă
  - **pad de mutare și rotire**: stânga/dreapta, departe/spre tine, sus/jos, relativ la cum privești scena; ții apăsat și se repetă
  - selecție multiplă: Ctrl/Cmd+click, Shift+trage un dreptunghi, Ctrl/Cmd+A
  - mutare și rotire pe grup
  - **grupuri** (Ctrl+G): click pe un obiect selectează tot grupul, Alt+click doar obiectul
  - **🔒 blocare** (K): obiectele așezate nu mai pot fi mutate sau șterse din greșeală; la hover se vede un contur (roșu dacă e blocat)
  - aliniere și distribuire egală
  - re-adresare DMX automată de la stânga la dreapta
  - **🎯 Țintește**: dai click pe punctul spre care să bată lumina, iar fixtura (sau grupul) se orientează singură
- **Gobo-uri și prisme reale**: proiectate pe podea, pereți și invitați, cu rotație gobo, 2 roți de gobo, prismă circulară și liniară, rotație prismă, 2 prisme pe același aparat și frost
- **Scenă**: caseuri (flight case), stative trepied cu bară T, truss, stâlpi, cabină DJ, boxe, subwoofere, podium, ring de dans, ecran LED, pereți, masa mirilor, mese rotunde și public animat.
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
- Merge **fără internet** (Three.js e inclus). Internetul trebuie doar ca să imporți fixturi din Open Fixture Library și pentru asistentul Claude.
- **Limbă**: română sau engleză, din **⚙ Setări → Limbă** sau butonul **RO / EN** din bara de sus.

## Instalare pe Mac (recomandat)

1. Descarcă `FreeVisualizer-…-mac.dmg` de la **Releases** pe GitHub: <https://github.com/JustIrinel/freevisualizer/releases/latest> (logat pe GitHub dacă repo-ul e privat).
2. Deschide `.dmg`-ul și trage **FreeVisualizer** în **Applications**.
3. **Prima pornire**. Aplicația nu e semnată cu un cont Apple Developer, așa că macOS o blochează o dată:
   - click dreapta pe FreeVisualizer → **Deschide** → **Deschide**;
   - pe macOS 15 sau mai nou: dacă tot apare blocată, mergi la **Setări sistem → Confidențialitate și securitate**, derulează până jos și apasă **Deschide oricum**.
4. Când macOS te întreabă de **Rețea locală**, apasă **Permite**. Fără permisiunea asta nu primești Art-Net de la alt calculator.

Aplicația pornește singură serverul, așa că nu ai nevoie de Node.js sau de terminal. Proiectele se salvează în `~/Library/Application Support/FreeVisualizer` (meniul **Ajutor → Folderul cu date**).

Din meniul **Vizualizare → Fereastră de prezentare** (Cmd+P) deschizi show-ul pe tot ecranul, pe al doilea monitor.

> Dacă vrei aplicația semnată (fără avertismentul de la prima pornire), adaugă în GitHub → Settings → Secrets: `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Ai nevoie de un cont Apple Developer, care costă 99 $/an. Build-ul o va semna și notariza automat.

## Instalare pe Windows

Descarcă `FreeVisualizer-…-windows-setup.exe` de pe aceeași pagină și rulează-l. Dacă apare SmartScreen: **Mai multe informații → Rulează oricum**.


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

### Cel mai simplu: direct din SoundSwitch

1. În SoundSwitch salvează proiectul (**File → Save Project**).
2. În FreeVisualizer: **Fixturi → ⇪ Importă din SoundSwitch** (sau **Nou → Din SoundSwitch**) și alege proiectul:
   - folderul care se termină în **.ssproj**, de obicei în **Muzică → SoundSwitch**;
   - sau o arhivă **.zip** a lui;
   - sau tragi folderul direct peste fereastră.
3. Vezi lista fixturilor exact ca în **DMX Map**: nume, model, mod, adresă. Apeși **Importă**.
4. Fixturile apar așezate automat: moving heads pe truss, par-uri pe podea, retro-uri în față. Numele de tipul „stânga / dreapta / centru / POZ 1” sunt folosite ca să le pună în ordine. Le muți apoi unde sunt în sala ta.
5. Ai schimbat ceva în SoundSwitch? Imporți din nou și alegi **Actualizează proiectul curent**: patch-ul se schimbă, pozițiile rămân.

Profilele (canalele, roțile de culori, strobe-ul) sunt luate **din definițiile SoundSwitch**, deci se comportă ca în SoundSwitch.

### Manual

1. **Nou → Rig nuntă** îți dă un punct de plecare complet. Îl adaptezi la sala ta.
2. **Fixturi → + Adaugă fixturi**: alegi profilul, cantitatea, universul și adresa de start, apoi montajul (pe podea, agățat pe truss, spre public). Retro-urile sunt profilele „Retro hexagonal 7 capete”, în 4 variante de canale.
   - Cu **🖱 Plasează cu mouse-ul** dai click în scenă pentru fiecare fixtură: pe truss se agață cu lumina în jos, pe podea stă cu lumina în sus, pe perete bate spre sală. **Esc** oprește.
3. Modelul tău nu e în lista generică? Scrie-l în căutarea din **Adaugă fixturi** (de exemplu „panther” sau „intimidator spot 260”):
   - dacă apare la **Open Fixture Library**, dai click și alegi **exact modul DMX** setat pe fixtură;
   - dacă nu, apeși **🔎 Caută pe Fixture.ID**: textul căutat e deja copiat, îl lipești în site și descarci fișierul **.d4**. În aplicația desktop se importă singur; în browser îl tragi peste fereastră.
   - Profilul rămâne salvat în proiect.
4. Click pe o fixtură în scenă ca s-o selectezi.
   - Mai multe deodată: **Ctrl/Cmd+click**, sau ții **Shift** și tragi un dreptunghi peste ele.
   - **W** = mutare (tragi de săgețile colorate), **E** = rotire (roșu = înclinare față/spate, verde = rotire stânga/dreapta, albastru = înclinare laterală).
   - Săgeata galbenă arată încotro bate lumina.
   - În dreapta ai **pad-ul**: **← Stânga / Dreapta →**, **↑ Departe / ↓ Spre tine**, **▲ Sus / ▼ Jos**, cu pași de 1 / 10 / 50 cm, plus rotire și înclinare cu pași de 1–90°. Direcțiile sunt cele de pe ecran, din orice unghi te uiți. Ții apăsat și se repetă; o apăsare = un pas de Undo.
   - Poziția exactă și cele 3 slidere de orientare sunt sub **Poziție exactă**.
   - Cel mai simplu e **🎯 Țintește**: apeși butonul, apoi dai click în scenă pe punctul unde vrei lumina.
5. **Scenă**: adaugi truss, cabină DJ, boxe, ecran LED și invitați, și setezi dimensiunile sălii.
6. **Ctrl+S** salvează proiectul. Cu **Export** iei fișierul `.json` și îl poți muta pe alt laptop.

### Scurtături

| Tastă | Acțiune |
| --- | --- |
| Ctrl/Cmd+click · Shift+trage | Selecție multiplă · dreptunghi de selecție |
| Ctrl/Cmd+A | Selectează toate fixturile |
| Ctrl/Cmd+G · Ctrl/Cmd+Shift+G | Grupează · desface grupul (Alt+click = un singur obiect din grup) |
| K | Blochează / deblochează selecția |
| W / E | Mută / rotește selecția |
| Săgeți · PageUp/PageDown | Mută 25 cm (Shift = 5 cm) relativ la cameră · sus/jos |
| [ / ] | Rotește ±15° (Shift = ±5°) |
| F | Centrează camera pe selecție |
| Ctrl+D | Duplică selecția (cu adresele următoare) |
| Del | Șterge |
| Ctrl+Z / Ctrl+Y | Anulează / refă |
| Ctrl+S | Salvează |
| H | Ascunde panourile (mod prezentare, ideal pe al doilea monitor) |
| D | Pornește/oprește demo |
| L | Etichete cu nume și adrese |
| 1–6 | Camere: 3D, față, sus, lateral, DJ, public |

### Asistentul Claude

1. Îți faci o cheie API pe <https://console.anthropic.com> (Settings → API Keys). Costul se plătește direct la Anthropic, după consum.
2. **⚙ Setări → Asistent Claude**: lipești cheia și apeși **Salvează**. Modelul implicit e **Claude Opus 5.5**; poți alege și Sonnet 5.5 sau Haiku 5.5 (mai rapide).
3. Apasă **✨ Asistent** în bara de sus și scrie ce vrei, de exemplu:
   - „Pune 4 BeamZ Panther 60 pe truss, de la adresa 200, modul 16 canale”
   - „Adaugă 6 par-uri RGBW pe peretele din spate”
   - „Ridică spoturile cu 30 cm și îndreaptă-le spre ring”
4. Claude caută profilul (în proiect, în profilele generice și în Open Fixture Library), adaugă fixturile, le așază și îți spune modul și adresele, ca să le potrivești cu SoundSwitch. Tot ce face un mesaj se anulează cu un singur **Ctrl+Z**.

Cheia rămâne doar pe calculatorul tău, în folderul cu date al aplicației, și nu ajunge niciodată în pagină. Poți folosi și variabila de mediu `ANTHROPIC_API_KEY`.

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
server/            Node.js: Art-Net, sACN, SSE către browser, proxy OFL, proiecte, modele 3D,
                   asistentul Claude (assistant.js, singura dependență: @anthropic-ai/sdk)
desktop/           aplicația Electron (Mac/Windows): fereastră, meniu, fereastră de prezentare
.github/workflows/ build .dmg (universal) + .exe la cerere (Actions → Run workflow), cu Release opțional
public/js/         aplicația (ES modules, Three.js r170 inclus în public/vendor)
  fixture-state.js DMX → culoare/intensitate/pan/tilt (pur, testat)
  ofl-import.js    Open Fixture Library → profil FreeVisualizer (pur, testat)
  ss-import.js     proiect SoundSwitch (SoundSwitchVenues.bin) → fixturi + profile (pur, testat)
  d4-import.js     Avolites .d4 (Fixture.ID) → profil; gdtf-import.js / qxf-import.js la fel
  fixtures3d.js    modelele 3D și fasciculele (piesele în fixture-parts.js, texturile în textures.js)
  models3d.js      modele .glb / GDTF încărcate pe fixturi, modele incluse (public/models, BUILTIN_MODELS)
  venue3d.js       sala de evenimente / sala goală, candelabre
  assistant.js     panoul asistentului Claude și instrumentele lui
  i18n.js          română / engleză (dicționarele în public/js/lang/)
  scene3d.js       scena, camera, bloom, selecție
  particles.js     particule (scântei, fum greu, reflexii glob)
  recorder.js      înregistrare clipuri video
tools/send-test-artnet.js   trimite un semnal Art-Net de test
scripts/update-ofl-snapshot.sh  actualizează lista OFL inclusă în aplicație (server/ofl-snapshot.json)
test/              teste (npm test)
```

- `npm test` rulează testele (parsere Art-Net/sACN, ArtPoll, import OFL, logica DMX).
- `npm run test-signal` trimite un curcubeu Art-Net către vizualizator, fără SoundSwitch.
- `npm install && npm run app` pornește aplicația desktop din cod.
- `npm start` pornește doar serverul + pagina în browser (pentru dezvoltare).
- `npm run dist:mac` construiește `.dmg`-ul; merge doar pe un Mac, altfel îl face GitHub Actions.

---

## English

FreeVisualizer is a 3D visualizer for **SoundSwitch**, in the spirit of Capture but simpler. Add the fixtures from your rig (moving heads, pars, retro lights, LED bars, strobes, cold sparks, low fog, mirror ball, laser), put them on the truss or the floor and watch the show live, with volumetric beams in haze, glow and light on the walls. Then record video clips with your logo for Instagram, TikTok or client offers.

It runs as a **Mac app** (Apple Silicon and Intel) and on Windows, and works with anything that sends **Art-Net** or **sACN (E1.31)**. The interface is in **English or Romanian**: switch in **⚙ Settings → Language** or with the **RO / EN** button in the top bar.

### Features

- **Live DMX** over Art-Net (UDP 6454) and sACN (UDP 5568). Answers ArtPoll, so SoundSwitch sees it as the Art-Net node “FreeVisualizer”.
- **Realistic fixtures**: pars/uplights, moving head spot / beam / wash (16-bit pan/tilt, color wheel, gobo, prism, zoom), LED pixel bars, the **7-head hexagonal retro** light with warm filament bulbs, strobe/blinder, fog/haze, **cold spark machines**, **low fog**, **mirror ball** with pinspots and **laser**.
- **Real 3D models**: **GDTF** files bring the manufacturer's 3D model (base, yoke and head moving with pan/tilt) and fixture photo; you can also load a **.glb** model into any profile.
- **DJ Matei's fixtures look like the real devices**, at real size, straight from the SoundSwitch import: BeamZ Panther 60 (built-in 3D model), Chauvet Intimidator Spot LED 250, UKing ZQ01104 (each red / green / blue LED lights in its own colour), the "7 Vintage" retro (RGB ring + warm-white filament per head, size set in the profile) and the ADJ Entour Faze hazer (haze comes out of the nozzle).
- **Venues**: a realistic **event venue** (parquet, wainscoting, curtains, coffered ceiling, chandeliers, a white drape behind the DJ), an **empty room** or a **dark club**. The **Room** slider sets the house lights; **💡** turns on work lights.
- **Import from SoundSwitch**: reads your `.ssproj` project and builds the same fixtures, names, modes and addresses as the SoundSwitch DMX Map, with the SoundSwitch fixture definitions.
- **Library**: built-in generic profiles, **one search** across your profiles and the [Open Fixture Library](https://open-fixture-library.org) (one-click import), a [Fixture.ID](https://www.fixture.id/) button, and import of **.d4**, **.gdtf**, **.zip** and **.json** files (just drop them on the window).
- **Real gobos and prisms**: projected onto the floor, walls and guests, with gobo rotation, 2 gobo wheels, circular and linear prisms, prism rotation, 2 prisms in one fixture and frost.
- **Groups and lock**: Ctrl+G groups objects (a click selects the whole group, Alt+click one object); K locks them so they can't be moved or deleted by mistake; hovering shows an outline (red when locked).
- **Stage**: road cases, tripod stands with a T-bar, truss, DJ booth, speakers, LED screen, tables and a realistic crowd.
- **Fast editing**: **place with the mouse** (truss, floor or wall – the fixture points the right way by itself), a **move & rotate pad** relative to your view, multi-select, group move/rotate, align and distribute, automatic left-to-right DMX re-addressing and **🎯 Aim** (click the spot the light should hit).
- **✨ Claude assistant**: tell it “Put 4 BeamZ Panther 60 on the truss from address 200” and it finds the profile, adds and places the fixtures and tells you the DMX mode and addresses. It uses your own Anthropic API key.
- **Patch**: universe and address per fixture, next free address filled in automatically, overlaps flagged, DMX monitor for all 512 channels.
- **Demo without SoundSwitch** (**▶ Demo**, 126 BPM) and manual channel faders in the inspector.
- **Video clips**: 9:16, 16:9 or 1:1 with your logo, text, cinematic camera and optional music.
- **Projects**: autosave, save (Ctrl+S), export/import `.json`, Undo/Redo. Works **offline** (internet is only needed for Open Fixture Library and the Claude assistant).

### Install

- **Mac:** download `FreeVisualizer-…-mac.dmg` from **Releases**, drag the app to **Applications**. First launch: **right-click → Open → Open** (the app is not signed with an Apple Developer account); on macOS 15+, if it is still blocked: **System Settings → Privacy & Security → Open Anyway**. Allow **Local Network** access when asked.
- **Windows:** download and run `FreeVisualizer-…-windows-setup.exe`.
- Downloads: <https://github.com/JustIrinel/freevisualizer/releases/latest>


### Connect SoundSwitch

1. Start **FreeVisualizer first**, then SoundSwitch.
2. In SoundSwitch: **Preferences → Hardware** → enable **Localhost Art-Net Node** (SoundSwitch 2.9+).
3. In FreeVisualizer use **Fixtures → ⇪ Import from SoundSwitch**, or add the **same fixtures with the same universe, address and DMX mode** as in the SoundSwitch DMX patch.
4. The indicator in the top-right turns green (“Receiving DMX”).

On another computer: put both on the same network (cable preferred), pick the “FreeVisualizer” Art-Net node or its IP (shown in **⚙ Settings**), and allow UDP **6454** / **5568** in the firewall. By default Art-Net universe 0 shows as **Universe 1**, like in SoundSwitch.

### Claude assistant

1. Create an API key at <https://console.anthropic.com> (Settings → API Keys). Usage is billed by Anthropic.
2. **⚙ Settings → Claude assistant**: paste the key and press **Save**. The default model is **Claude Opus 5.5**; Sonnet 5.5 and Haiku 5.5 are faster options.
3. Tick **Show the ✨ Assistant button** if needed, press **✨ Assistant** in the top bar and type what you want, e.g. “Add 6 RGBW pars on the back wall” or “Raise the spots by 30 cm and aim them at the dance floor”.

Everything one message does is undone with a single **Ctrl+Z**. The key stays on your computer (in the app's data folder) and is never sent to the page. The `ANTHROPIC_API_KEY` environment variable works too.

### Shortcuts

| Key | Action |
| --- | --- |
| Ctrl/Cmd+click · Shift+drag | Multi-select · selection box |
| Ctrl/Cmd+A | Select all fixtures |
| Ctrl/Cmd+G · Ctrl/Cmd+Shift+G | Group · ungroup (Alt+click = one object in a group) |
| K | Lock / unlock the selection |
| W / E | Move / rotate the selection |
| Arrows · PageUp/PageDown | Move 25 cm (Shift = 5 cm) relative to the camera · up/down |
| [ / ] | Rotate ±15° (Shift = ±5°) |
| F | Focus the camera on the selection |
| Ctrl+D | Duplicate (with the next addresses) |
| Del | Delete |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+S | Save |
| H | Hide the panels (presentation mode) |
| D | Demo on/off |
| L | Name and address labels |
| 1–6 | Cameras: 3D, front, top, side, DJ, audience |

### Troubleshooting

- **“No DMX data”**: check *Localhost Art-Net Node* and restart SoundSwitch *after* starting FreeVisualizer.
- **“Port 6454 is busy”**: another visualizer (e.g. Capture) is listening on the port. Close it and start again.
- **Wrong colors or movement**: the DMX mode (channel count) differs between the profile and SoundSwitch. Check each channel with the “Channel test” faders.
- **Moving head moves the wrong way**: tick “Invert pan” or “Invert tilt” in the inspector.

© 2026 DJ Matei – uz personal, toate drepturile rezervate / personal use, all rights reserved (vezi `LICENSE`). Three.js, Open Fixture Library, Electron și @anthropic-ai/sdk sunt distribuite sub licența MIT.

Modelul 3D al lui BeamZ Panther 60 (`public/models/panther-60.glb`) este „Moving Head Beam (high Poly)” de [Lord Henry](https://sketchfab.com/lordhenry) ([Sketchfab](https://sketchfab.com/3d-models/ce283a1277bb4e98bd29b157075e003f)), licență [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), modificat (scalat, înnegrit) – vezi `public/models/CREDITS.md`. / The BeamZ Panther 60 3D model is "Moving Head Beam (high Poly)" by Lord Henry, CC BY 4.0, modified (scaled, darkened).
