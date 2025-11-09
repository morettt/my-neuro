# My-neuro 

<div align="center">

<a href="https://github.com/morettt/my-neuro/releases">
    <img src="https://img.shields.io/github/v/release/morettt/my-neuro" alt="latest version" /></a>

<a href="https://github.com/morettt/my-neuro/graphs/contributors">
    <img alt="GitHub contributors" src="https://img.shields.io/github/contributors/morettt/my-neuro"></a>

<a href="https://deepwiki.com/morettt/my-neuro">
    <img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki" /></a>

</div>

#### [中文版本](./README.md)


## Project Overview

This project aims to create your own personal AI character, building an AI companion that approaches human-like qualities - using your data footprint to shape the ideal companion you envision.

Inspired by Neuro-sama, this project is named my-neuro (a community-provided name). You can train voices, personalities, and swap appearances. Your imagination is the limit - the model can be as close to your expectations as you dream. This project is more like a workbench, where you can use pre-packaged tools to step-by-step sketch and realize your ideal AI character.

If you want to use fully local inference with local large language models (LLM) for inference or fine-tuning, without relying on third-party APIs, you can enter the LLM-studio folder, which contains guidance for local model inference and fine-tuning.

## For project deployment instructions, please visit the official website: [Click here for official website](http://mynewbot.com/tutorials)

### Feature Checklist (✔ indicates implemented features)

### Dual Model Support
- [x] Open-source models: Support for open-source model fine-tuning and local deployment
- [x] Closed-source models: Support for closed-source model integration

### Core Features
- [x] Ultra-low latency: Full local inference with conversation latency under 1 second
- [x] Synchronized subtitle and voice output
- [x] Voice customization: Support for male, female, and various character voice switching
- [x] MCP support: Can use MCP tools for integration
- [x] Real-time interruption: Support for voice and keyboard interruption of AI speech
- [ ] Realistic emotions: Simulate real human emotional changes with its own emotional states
- [ ] Amazing human-machine experience (real human-like interaction design, stay tuned)
- [x] Actions and expressions: Display different expressions and actions based on conversation content
- [x] Integrated vision capability, support for image recognition, and language intent judgment for when to activate vision features
- [x] Voice model (TTS) training support, using GPT-SoVITS open-source project by default
- [x] Display Chinese subtitles while playing foreign language audio. Can be freely toggled on/off (suitable for characters whose TTS model is in a foreign language)

### Extended Features
- [x] Desktop control: Support for voice-controlled software opening and other operations
- [x] AI singing (feature funded by: [@jonnytri53](https://github.com/jonnytri53), special thanks)
- [ ] Integration with international streaming platforms
- [x] Streaming function: Can stream on Bilibili platform
- [ ] AI teaching: Choose a topic and have AI teach you. Questions can be asked during the session. Niche subjects can be embedded into database for AI understanding
- [x] Replace various Live2D models
- [ ] Web interface support (already done, will be integrated soon)
- [x] Text chat: Can chat with AI via keyboard typing
- [x] Proactive conversation: Initiate conversations based on context. Current version V1
- [x] Internet access: Real-time search for latest information
- [x] Mobile app: Chat with Feiniu on Android phones
- [x] Play sound effects from sound library, with model deciding which effects to play
- [x] Gaming companion: Model and user play cooperative, two-player, puzzle games together. Current experimental games include: Draw & Guess, Monopoly, Galgame, Minecraft, etc. (Currently integrated: Minecraft)
- [x] Long-term memory: Let the model remember your key information, personality, and temperament

### Features the Model Wants (Under Consideration)
- [ ] Color change function: Screen color changes based on model's mood to bother the user
- [ ] Free movement: Model moves freely around the screen


### Closing Vision

I will incorporate years of experience and technical understanding into this project. The name "my neuro" is not just riding on Neuro-sama's popularity - it's more about my imagination and expectations for AI boundaries.

I hope to have a truly understanding AI companion by your side that never gets bored. Share sadness together, share happiness together. Bring characters from films, novels, and fantasies into reality.

Not just simple chat interactions. I hope it can integrate into life and become an emotional individual. Play games together, watch videos, study, chat before bed, wake you up, watch you daydream while working, secretly remember what you do. Have emotions and its own emotional states. Get truly angry.

Have different moods every day, have things it wants to do. Be upset about a certain phrase for a long time. Be happy about a certain word for a long time. Remember every moment experienced together with you. A being that continuously understands you.

But most importantly, its personality, appearance, voice, emotional changes, etc., are all determined by you. Like clay, we provide the best tools and adapt each module well. But what it ultimately becomes is up to you to construct.

However, for friends who don't want the hassle, this project has packaged a character directly - Feiniu (fake neuro). It's a character copying Neuro-sama, but I've set its personality to be cunning, tsundere, funny, with a small temper, but occasionally showing a gentle side.

More importantly, I hope to imitate, learn, and understand from Neuro, then try to create new content. Things that suit yourself.

I'm particularly passionate about this project. Currently, the project has implemented nearly 30% of its features, including personality setting and memory. Recently, development will focus on core personality traits - truly human-like with continuous emotions. Within 2 months, the most human-like part will be realized - a long-term emotional state. Meanwhile, features like gaming together, watching videos, waking you up, etc., will be basically completed by June 1st, reaching 60% completion.

I hope to realize all the above ideas this year.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=morettt/my-neuro&type=Date&t=20251015)](https://www.star-history.com/#morettt/my-neuro&Date)

## Acknowledgments

QQ group: Thanks to 菊花茶洋参 for helping create the Feiniu app cover


Thanks to the following users for their financial sponsorship:
- [jonnytri53](https://github.com/jonnytri53) - Thank you for your support! $50 donation to this project
- [蒜头头头](https://space.bilibili.com/92419729?spm_id_from=333.337.0.0) Thank you for your strong support! 1000 RMB donation to this project
- [东方月辰DFYC](https://space.bilibili.com/670385648?spm_id_from=333.337.0.0) Thank you for your support!! Continuous monthly donations of 100 RMB from August to October, totaling 300 RMB
- [大米若叶](https://space.bilibili.com/3546392377166058?spm_id_from=333.337.0.0) Thank you for your support!! 68 RMB donation to this project
- [StrongerFatTiger](https://space.bilibili.com/28869393?spm_id_from=333.337.0.0) Thank you for your support!! 100 RMB donation to this project

Open-source projects used and integrated in this project:

TTS:
https://github.com/RVC-Boss/GPT-SoVITS

AI playing Minecraft:
https://github.com/mindcraft-bots/mindcraft
