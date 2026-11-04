# Pocket terms and publishing risk

Researched 2026-11-01. This is a source-backed reading of the vendor's terms and of the relevant law, not legal advice. Re-check the terms' "Last modified" date before relying on it.

## Vendor and governing terms

Pocket is sold by Open Vision Engineering, Inc. (Delaware corporation). Its [Terms of Use](https://heypocket.com/pages/terms), last modified 2025-09-15, cover the website, the apps, and the Pocket device with its firmware. Delaware law governs them. Disputes between a user and the company go to individual AAA arbitration, with a 30-day opt-out window, but either side may go to court for intellectual-property infringement.

Clauses that apply to OpenPocket:

- **Prohibited uses:** users may not "disassemble, decompile, reverse-engineer, or otherwise tamper with" the device "or any associated software or firmware". This clause has no "except where law allows" qualifier.
- **Updates:** users may not reverse-engineer, decompile, or circumvent the update mechanisms, "except to the extent such restrictions are prohibited by law". OpenPocket does not touch firmware updates.
- **Automated access:** robots and other automated means are banned only "for unauthorized purposes". No clause bans third-party apps or clients by name.
- **Credentials:** users must keep credentials confidential and may not disclose them to another person or entity. OpenPocket's OAuth sign-in happens on Pocket's own authorization server, so the app never sees the password.
- **Trademarks:** the company name, product names, and logos may not be used without prior written permission.
- **Licence:** personal, non-commercial use only.

## Vendor-sanctioned third-party access

Pocket publishes OAuth metadata with dynamic client registration and an `mcp:read` scope (`public.heypocketai.com/.well-known/oauth-authorization-server`). Users can create personal API keys under Settings → Developer, and Pocket documents a public REST API and MCP server for "custom integrations" at [docs.heypocketai.com](https://docs.heypocketai.com). No API-specific terms were found there. OpenPocket's account path uses only these channels.

What these channels do not cover: the Bluetooth and Wi-Fi protocol, and the recorder key. The key is the first 16 characters of the user ID, padded with zeros (`deriveCandidateKey`). That algorithm was learned from the vendor's web app and from [Pocket Libre](https://github.com/shahcolate/pocket-libre). Neither is published by Pocket.

## Precedent

- **Pocket Libre** (MIT) has been public since 2026-03-28. As of 2026-11-01 it had 58 stars, a push on 2026-10-21, and no takedown- or legal-related issues. It goes further than OpenPocket, including pairing a reset device without the vendor app.
- **Haier** sent a cease-and-desist letter to the developer of an open-source Home Assistant integration in 2024. The letter claimed unauthorized use of Haier's services and financial damage. The developer took the project down, citing defence costs ([BleepingComputer](https://www.bleepingcomputer.com/news/security/haier-hits-home-assistant-plugin-dev-with-takedown-notice)).

## Legal background (from general knowledge; not re-verified in this pass)

- **US contract law:** courts have enforced anti-reverse-engineering clauses (e.g. *Bowers v. Baystate*, Fed. Cir. 2003).
- **US anti-circumvention law:** 17 U.S.C. §1201(f) permits circumvention for interoperability of independently created programs. *Chamberlain v. Skylink* (Fed. Cir. 2004) tied §1201 liability to infringement.
- **US computer-access law:** *Van Buren* (2021) narrowed the CFAA, so a terms-of-service breach alone is generally not a CFAA violation.
- **EU law:** Software Directive 2009/24/EC Art. 5(3) lets users observe and test how a program works, and Art. 6 allows decompilation for interoperability. Art. 8 voids contract terms that override these rights.

## Risk summary

The main exposures are a contract claim based on the reverse-engineering clause and a trademark complaint about the name "OpenPocket". The likeliest enforcement is a cease-and-desist letter, a GitHub takedown request, or account suspension rather than a lawsuit. Keep the current boundaries: official activation required, no firmware changes, and no vendor code or assets. The README carries the disclaimer of affiliation (added 2026-11-01). The project name still contains "Pocket", and the app itself has no disclaimer yet.
