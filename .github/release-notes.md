Vizualizator 3D **gratuit** pentru **SoundSwitch** (Art-Net / sACN): adaugi fixturile din rigul tău și vezi show-ul live.
*English below.*

## Ce e nou în 1.5

- **Română sau engleză**: alegi limba din **⚙ Setări → Limbă** sau din butonul **RO / EN** din bara de sus. Meniul aplicației se schimbă și el.
- **Fixturi care arată ca aparatele reale**:
  - beam-uri compacte cu display și lentilă mare;
  - spoturi cu grile de ventilație;
  - wash-uri cu LED-uri vizibile;
  - par-uri plate cu bracket;
  - retro-uri cu reflectoare aurii;
  - hazer, scântei, strobe, toate cu materiale realiste (metal, plastic, sticlă).
- **Modele 3D reale**:
  - fișierele **GDTF** își aduc modelul 3D al producătorului (bază, braț, cap, care se mișcă pe pan/tilt) și poza aparatului;
  - poți încărca și un model **.glb** în profilul fixturii.
- **Sală de evenimente realistă**: parchet, lambriu, ferestre cu draperii, tavan casetat, candelabre și draperie albă în spatele DJ-ului. Mai ai **Sală goală** și **Club (întunecat)**.
- **Lumina din sală**:
  - slider-ul **Sală** din scenă aprinde candelabrele și luminează ambientul;
  - butonul **💡** dă lumină de lucru, ca să așezi fixturile ușor.
- **Plasare cu mouse-ul**: în „Adaugă fixturi” apeși **🖱 Plasează cu mouse-ul** și dai click unde vrei fiecare aparat.
  - Pe truss se agață cu lumina în jos, pe podea stă cu lumina în sus, pe perete bate spre sală.
- **Pad de mutare și rotire** în inspector: **Stânga / Dreapta, Departe / Spre tine, Sus / Jos**, relativ la cum privești scena, cu pași de 1 / 10 / 50 cm.
  - Ții apăsat și se repetă.
  - Rotirea are pași de 1–90°.
  - Săgețile de pe tastatură mută tot relativ la cameră.
- **✨ Asistent Claude**: scrii „Pune 4 BeamZ Panther 60 pe truss de la adresa 200” și Claude caută profilul, adaugă fixturile, le așază și îți spune adresele.
  - Folosește cheia ta API de la Anthropic, pusă în **⚙ Setări → Asistent Claude**.
  - Cheia rămâne doar pe calculatorul tău.
  - Modelul implicit e Claude Opus 5.5.

## Ce era nou în 1.4

- **Importă din SoundSwitch**: alegi proiectul `.ssproj` și primești aceleași fixturi, cu aceleași nume, moduri și adrese ca în DMX Map.

## Instalare pe Mac

1. Descarcă **`FreeVisualizer-1.5.0-mac.dmg`** de mai jos, deschide-l și trage FreeVisualizer în **Applications**.
2. La prima pornire: **click dreapta pe aplicație → Deschide → Deschide**.
   Pe macOS 15 sau mai nou, dacă tot e blocată, mergi la **Setări sistem → Confidențialitate și securitate** și apasă **Deschide oricum**.
3. Când apare întrebarea despre **Rețea locală**, apasă **Permite**.

## Instalare pe Windows

Descarcă **`FreeVisualizer-1.5.0-windows-setup.exe`** și rulează-l. Dacă apare SmartScreen, alege **Mai multe informații → Rulează oricum**.

## Conectare cu SoundSwitch

1. Pornește **întâi FreeVisualizer**, apoi SoundSwitch.
2. În SoundSwitch: **Preferences → Hardware** → bifează **Localhost Art-Net Node**.
3. Cel mai simplu: **Fixturi → ⇪ Importă din SoundSwitch**. Indicatorul din dreapta sus devine verde când primește semnal.

---

## English

A **free** 3D visualizer for **SoundSwitch** (Art-Net / sACN): add the fixtures from your rig and watch the show live.

### What's new in 1.5

- **English or Romanian**: pick the language in **⚙ Settings → Language** or with the **RO / EN** button in the top bar. The app menu follows too.
- **Fixtures that look like the real thing**:
  - compact beams with a display and a big lens;
  - spots with vent grilles;
  - washes with visible LEDs;
  - flat pars with brackets;
  - retro lights with gold reflectors;
  - hazer, spark machine and strobe, all with realistic metal, plastic and glass.
- **Real 3D models**:
  - **GDTF** files bring the manufacturer's 3D model (base, yoke and head moving with pan/tilt) and the fixture photo;
  - you can also load a **.glb** model into a fixture profile.
- **Realistic event hall**: parquet floor, wainscoting, windows with curtains, coffered ceiling, chandeliers and a white drape behind the DJ. **Empty room** and **Club (dark)** are there too.
- **House lights**:
  - the **Room** slider turns on the chandeliers and lifts the ambient light;
  - **💡** gives you work lights while you place fixtures.
- **Place with the mouse**: in “Add fixtures” press **🖱 Place with the mouse** and click where each fixture goes.
  - On the truss it hangs pointing down, on the floor it points up, on a wall it faces the room.
- **Move & rotate pad** in the inspector: **Left / Right, Away / Towards you, Up / Down**, relative to your view, in steps of 1 / 10 / 50 cm.
  - Hold a button to repeat.
  - Rotation steps go from 1° to 90°.
  - The arrow keys also move relative to the camera.
- **✨ Claude assistant**: type “Put 4 BeamZ Panther 60 on the truss from address 200” and Claude finds the profile, adds and places the fixtures, and tells you the addresses.
  - It uses your own Anthropic API key, set in **⚙ Settings → Claude assistant**.
  - The key stays on your computer.
  - The default model is Claude Opus 5.5.

### Install

- **Mac:** download **`FreeVisualizer-1.5.0-mac.dmg`**, drag FreeVisualizer to **Applications**.
  - First launch: **right-click → Open → Open**. On macOS 15+, if it is still blocked: **System Settings → Privacy & Security → Open Anyway**.
  - Allow **Local Network** access when asked.
- **Windows:** run **`FreeVisualizer-1.5.0-windows-setup.exe`**. If SmartScreen appears: **More info → Run anyway**.

### Connect SoundSwitch

1. Start **FreeVisualizer first**, then SoundSwitch.
2. In SoundSwitch: **Preferences → Hardware** → enable **Localhost Art-Net Node**.
3. Easiest: **Fixtures → ⇪ Import from SoundSwitch**. The indicator in the top-right turns green when DMX arrives.
