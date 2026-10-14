Vizualizator 3D **gratuit** pentru **SoundSwitch** (Art-Net / sACN): adaugi fixturile din rigul tău și vezi show-ul live.

## Ce e nou în 1.4

- **Importă din SoundSwitch**: alegi proiectul tău SoundSwitch (folderul `.ssproj` din Muzică → SoundSwitch, sau un `.zip` al lui) și FreeVisualizer pune în scenă **aceleași fixturi, cu aceleași nume, moduri și adrese ca în DMX Map**.
  - Canalele, roțile de culori și strobe-ul sunt luate din definițiile SoundSwitch.
  - Fixturile sunt așezate automat (moving heads pe truss, par-uri pe podea, retro-uri în față), în ordinea dată de nume (stânga / centru / dreapta, POZ 1, 2…).
  - Ai schimbat ceva în SoundSwitch? Imporți din nou cu **Actualizează proiectul curent**: pozițiile rămân.
- Butonul e în **Fixturi → ⇪ Importă din SoundSwitch**, în **Nou → Din SoundSwitch** și în meniul **Fișier**. Poți și trage folderul proiectului peste fereastră.

## Ce era nou în 1.3

- **O singură căutare** în „Adaugă fixturi”: scrii modelul (ex. „panther”) și vezi deodată profilele tale, rezultatele din **Open Fixture Library** (import cu un click) și butonul **🔎 Caută pe Fixture.ID**.
- **Fișiere .d4 de pe Fixture.ID**: le tragi peste fereastră sau din **Import fișier**. Merg și arhivele .zip.
- **Fixture.ID direct în aplicație** (Mac / Windows): se deschide într-o fereastră proprie, textul căutat e deja copiat, iar fișierul descărcat se importă singur.
- Lista Open Fixture Library e inclusă în aplicație, deci căutarea merge din prima.
- Click pe o fixtură agățată de truss o selectează pe ea, nu truss-ul.

## Ce era nou în 1.2

- **Selecție multiplă**:
  - Ctrl/Cmd+click în scenă și în listă
  - Shift + trage = dreptunghi de selecție
  - Ctrl/Cmd+A = toate fixturile
- **Editare de grup**: muți sau rotești tot grupul deodată, aliniezi, distribui egal, re-adresezi DMX de la stânga la dreapta și schimbi profilul pentru toate.
- **Mutare și rotire mai clare**:
  - o săgeată galbenă arată încotro bate lumina
  - orientarea se face din 3 slidere cu nume clare: înclinare față/spate, rotire stânga/dreapta, înclinare laterală
  - butonul **🎯 Țintește**: dai click pe punctul spre care să bată lumina
- **Import GDTF (.gdtf)**: fișierul descărcat se trage direct peste fereastră.

## Ce era nou în 1.1

- **Aplicație pentru Mac** (Apple Silicon + Intel) și **Windows**, fără Node.js sau terminal
- **Retro hexagonal cu 7 capete**: bec cald cu filament realist, plus variantele RGB / RGB + alb cald
- **Efecte de nuntă**:
  - scântei reci
  - fum greu („dans în nori”)
  - glob disco cu pinspot-uri
  - laser
- **Șablon „Rig nuntă”**: cabină DJ, truss, uplight-uri, ring de dans, masa mirilor și mese
- **Clipuri video** pentru clienți: format 9:16, 16:9 sau 1:1, cu logo-ul tău și muzică (buton **● Clip**)
- **Fereastră de prezentare** pentru al doilea monitor (Cmd+P)

## Instalare pe Mac

1. Descarcă **`FreeVisualizer-1.4.0-mac.dmg`** de mai jos, deschide-l și trage FreeVisualizer în **Applications**.
2. La prima pornire: **click dreapta pe aplicație → Deschide → Deschide**.
   Pe macOS 15 sau mai nou, dacă tot e blocată, mergi la **Setări sistem → Confidențialitate și securitate** și apasă **Deschide oricum**.
3. Când apare întrebarea despre **Rețea locală**, apasă **Permite**.

Avertismentul de la pasul 2 apare doar o dată. Aplicația nu e semnată cu un cont Apple Developer.

## Instalare pe Windows

Descarcă **`FreeVisualizer-1.4.0-windows-setup.exe`** și rulează-l. Dacă apare SmartScreen, alege **Mai multe informații → Rulează oricum**.

## Conectare cu SoundSwitch

1. Pornește **întâi FreeVisualizer**, apoi SoundSwitch.
2. În SoundSwitch: **Preferences → Hardware** → bifează **Localhost Art-Net Node**.
3. În FreeVisualizer, fixturile trebuie să aibă **același univers, aceeași adresă și același mod DMX** ca în SoundSwitch. Când primește semnal, indicatorul din dreapta sus devine verde.
