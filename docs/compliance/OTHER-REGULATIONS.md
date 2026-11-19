# Other applicable rules

**Not legal advice** – see [README.md](README.md).

| Rule | Relevance for Levuvo Mail | Status / measure |
| --- | --- | --- |
| **ePrivacy Directive 2002/58/EC**, Art. 5(1) confidentiality of communications; Art. 5(3) terminal equipment; Austria: **TKG 2021 § 165** | Levuvo is not a communications provider; Art. 5(3) relevant for anything stored on or read from the device for third parties. Levuvo stores only what the user's own app needs (strictly necessary); no tracking, no analytics | Done. External images (tracking pixels of senders) blocked by default; crash reports opt-in |
| **NIS2**, Directive (EU) 2022/2555; Austria: NISG (check the status of the national transposition) | Levuvo as a small software vendor is not an essential/important entity (software publishing is not an Annex I/II sector; managed service providers are). Customers that are NIS2 entities must manage supply-chain risks (Art. 21(2)(d)) and will ask for SBOM, CVD, support period and update policy | Done: the CRA documents answer these questions; provide [CRA.md](CRA.md) on request |
| **Product Liability Directive**, Directive (EU) 2024/2853 | Software is a product (Art. 4(1)); manufacturer liable for defects incl. missing security updates within its control (Art. 11(2)); cannot be excluded towards injured persons; applies to products placed on the market after 9 Dec 2026 | **Decision:** product liability insurance and contract terms before selling |
| **Digital Content Directive** (EU) 2019/770; Austria: **VGG** | Only for consumer sales: duty to supply updates incl. security updates for the period the consumer can reasonably expect (Art. 8) | Covered by the support period; terms of sale needed (**Decision**) |
| **General Product Safety Regulation** (EU) 2023/988 | Applies to consumer products; standalone software is generally assessed under the CRA/PLD. Low relevance | n/a, re-check for consumer sales |
| **Data Act**, Regulation (EU) 2023/2854 | Applies to connected products and related services and to data processing services (cloud switching). Levuvo Mail is neither | n/a |
| **Dual-use export control**, Regulation (EU) 2021/821 | Encryption (TLS, OpenPGP, S/MIME, AES) is in Category 5 Part 2; mass-market software with standard cryptography is released by Note 3 (cryptography note). US EAR may apply to US-origin components and US hosting (GitHub): mass-market, 5D992.c | Low risk; **Decision:** confirm classification before export outside the EU, no sales to embargoed countries |
| **Austrian E-Commerce-Gesetz § 5, UGB § 14, MedienG § 25** | Imprint on website and in the app | Template [docs/IMPRESSUM.md](../IMPRESSUM.md); data: **Decision** |
| **ArbVG §§ 96, 96a** | Systems that can monitor employees or process their data need a works agreement or consent | Templates in [docs/ai/USAGE-POLICY.md](../ai/USAGE-POLICY.md); AI log without content, not for performance control |
| **BAO § 132, UGB § 212** (retention of business mail, 7 years) | The AI never deletes permanently (trash only after approval) | Done |
| **Professional secrecy** (lawyers § 9 RAO, tax advisers § 80 WTBG, doctors § 54 ÄrzteG, banking § 38 BWG …) | Cloud AI and agents could breach secrecy | Per-account "No cloud AI", local model default; DPIA template; [gdpr/THIRD-PARTY-DATA-CLOUD-AI.md](gdpr/THIRD-PARTY-DATA-CLOUD-AI.md) option B |
| **eIDAS 2** (EU) 2024/1183 | S/MIME signatures are advanced at most, not qualified; no claims of qualified signatures | Done (no such claims in the UI) |
| **Copyright / trademark** | Own logo and name; third-party marks (Microsoft, Google, Claude) only descriptively | Done |
| **Consumer law (Omnibus Directive, unfair terms)** | Only for consumer sales | **Decision:** terms of sale/EULA by a lawyer |
| **Open-source licences** | Electron, npm, CPython, PyPI, Ollama, models | [LICENSING.md](LICENSING.md) |
