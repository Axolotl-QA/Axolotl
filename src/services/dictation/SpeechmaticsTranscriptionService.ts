import { Logger } from "@services/logging/Logger";
import WebSocket from "ws";

const SPEECHMATICS_WS_URL = "wss://eu2.rt.speechmatics.com/v2";

interface SpeechmaticsResult {
	type: string;
	alternatives: { content: string; confidence: number }[];
	attaches_to?: string;
}

interface SpeechmaticsMessage {
	message: string;
	metadata?: { transcript?: string; start_time?: number; end_time?: number };
	results?: SpeechmaticsResult[];
	reason?: string;
	type?: string;
	seq_no?: number;
	code?: number;
}

export class SpeechmaticsTranscriptionService {
	/**
	 * Transcribes audio using Speechmatics real-time WebSocket API.
	 * Sends the complete audio file (OGG/Opus) and collects all transcript segments.
	 *
	 * @param audioBase64 Base64-encoded audio file (OGG/Opus format from FFmpeg)
	 * @param language ISO language code (e.g., "en", "zh", "ja")
	 * @returns Object with transcribed text or error message
	 */
	async transcribeAudio(
		audioBase64: string,
		language?: string,
		apiKey?: string,
	): Promise<{ text?: string; error?: string }> {
		if (!apiKey) {
			return {
				error:
					"Speechmatics API key is not configured. Please set it in Settings > Features > Dictation.",
			};
		}
		const lang = language || "en";

		return new Promise((resolve) => {
			const audioBuffer = Buffer.from(audioBase64, "base64");
			let transcript = "";
			let endOfStreamSent = false;
			let resolved = false;

			console.log(
				`[Speechmatics] Starting transcription, audio size: ${audioBuffer.length} bytes, language: ${lang}`,
			);

			const safeResolve = (result: { text?: string; error?: string }) => {
				if (!resolved) {
					resolved = true;
					resolve(result);
				}
			};

			// Set a timeout to prevent hanging forever
			const timeout = setTimeout(() => {
				console.error(
					"[Speechmatics] Transcription timed out after 60 seconds",
				);
				Logger.error("Speechmatics transcription timed out after 60 seconds");
				try {
					ws.close();
				} catch {
					// ignore close errors
				}
				safeResolve({ error: "Transcription timed out. Please try again." });
			}, 60_000);

			const ws = new WebSocket(SPEECHMATICS_WS_URL, {
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			});

			ws.on("open", () => {
				console.log(
					"[Speechmatics] WebSocket connected, sending StartRecognition...",
				);
				Logger.info(
					"Speechmatics WebSocket connected, sending StartRecognition...",
				);

				// Send StartRecognition with file-based audio format
				const startMsg = {
					message: "StartRecognition",
					audio_format: {
						type: "file",
					},
					transcription_config: {
						language: lang,
						operating_point: "enhanced",
						enable_partials: false,
					},
				};
				ws.send(JSON.stringify(startMsg));
			});

			ws.on("message", (data: WebSocket.Data) => {
				try {
					const msg: SpeechmaticsMessage = JSON.parse(data.toString());
					console.log(
						`[Speechmatics] Received message: ${msg.message}`,
						msg.metadata?.transcript
							? `transcript: "${msg.metadata.transcript}"`
							: "",
					);

					switch (msg.message) {
						case "RecognitionStarted":
							console.log(
								`[Speechmatics] Recognition started, sending ${audioBuffer.length} bytes of audio...`,
							);
							Logger.info(
								"Speechmatics recognition started, sending audio data...",
							);
							// Send the audio file as binary
							ws.send(audioBuffer);
							break;

						case "AudioAdded":
							// Send EndOfStream only once after audio is acknowledged
							if (!endOfStreamSent) {
								endOfStreamSent = true;
								console.log(
									"[Speechmatics] Audio acknowledged, sending EndOfStream...",
								);
								ws.send(
									JSON.stringify({
										message: "EndOfStream",
										last_seq_no: msg.seq_no ?? 0,
									}),
								);
							}
							break;

						case "AddTranscript":
							// Transcript text is in metadata.transcript
							if (msg.metadata?.transcript) {
								transcript += msg.metadata.transcript;
								console.log(
									`[Speechmatics] Transcript chunk: "${msg.metadata.transcript}"`,
								);
							}
							break;

						case "AddPartialTranscript":
							// Ignore partials since enable_partials is false
							break;

						case "EndOfTranscript":
							console.log(
								`[Speechmatics] Transcription complete. Full transcript: "${transcript.trim()}"`,
							);
							Logger.info("Speechmatics transcription complete");
							clearTimeout(timeout);
							ws.close();
							safeResolve({
								text: transcript.trim() || undefined,
								error: transcript.trim()
									? undefined
									: "No speech detected in the audio.",
							});
							break;

						case "Error":
							console.error(
								`[Speechmatics] Error: type=${msg.type}, reason=${msg.reason}, code=${msg.code}`,
							);
							Logger.error(`Speechmatics error: ${msg.type} - ${msg.reason}`);
							clearTimeout(timeout);
							ws.close();
							safeResolve({
								error: this.mapSpeechmaticsError(
									msg.type,
									msg.reason,
									msg.code,
								),
							});
							break;

						default:
							console.log(
								`[Speechmatics] Other message: ${msg.message}`,
								JSON.stringify(msg).substring(0, 200),
							);
							Logger.info(`Speechmatics message: ${msg.message}`);
							break;
					}
				} catch (parseError) {
					console.error("[Speechmatics] Failed to parse message:", parseError);
					Logger.error("Failed to parse Speechmatics message:", parseError);
				}
			});

			ws.on("error", (err: Error) => {
				console.error("[Speechmatics] WebSocket error:", err.message);
				Logger.error("Speechmatics WebSocket error:", err);
				clearTimeout(timeout);
				safeResolve({
					error: this.mapConnectionError(err),
				});
			});

			ws.on("close", (code: number, reason: Buffer) => {
				console.log(
					`[Speechmatics] WebSocket closed, code: ${code}, reason: ${reason.toString()}`,
				);
				clearTimeout(timeout);
				if (!resolved) {
					if (code === 1000 || code === 1005) {
						// Normal close - if we have transcript, return it
						if (transcript.trim()) {
							safeResolve({ text: transcript.trim() });
						} else {
							safeResolve({ error: "No speech detected in the audio." });
						}
					} else {
						safeResolve({
							error: `Connection closed unexpectedly (code: ${code}, reason: ${reason.toString()}). Please try again.`,
						});
					}
				}
			});
		});
	}

	private mapSpeechmaticsError(
		type?: string,
		reason?: string,
		code?: number,
	): string {
		switch (type) {
			case "invalid_message":
				return "Invalid audio format. Please try recording again.";
			case "invalid_model":
			case "invalid_language":
				return `Unsupported language. ${reason || ""}`;
			case "quota_exceeded":
				return "Speechmatics API quota exceeded. Please try again later.";
			case "timelimit_exceeded":
				return "Audio too long. Please record a shorter message.";
			case "not_authorised":
				return "Speechmatics API key is invalid or expired.";
			case "job_error":
				return "Transcription failed. Please try again.";
			default:
				return reason || "Transcription error. Please try again.";
		}
	}

	private mapConnectionError(err: Error): string {
		const msg = err.message.toLowerCase();
		if (msg.includes("enotfound") || msg.includes("getaddrinfo")) {
			return "No internet connection. Please check your network and try again.";
		}
		if (msg.includes("econnrefused")) {
			return "Cannot connect to Speechmatics service. Please check your internet connection.";
		}
		if (msg.includes("etimedout") || msg.includes("econnreset")) {
			return "Connection timed out. Please try again.";
		}
		if (msg.includes("401") || msg.includes("unauthorized")) {
			return "Speechmatics API key is invalid. Please check your configuration.";
		}
		return `Network error: ${err.message}`;
	}
}

// Lazily construct the service
let _speechmaticsInstance: SpeechmaticsTranscriptionService | null = null;
export function getSpeechmaticsTranscriptionService(): SpeechmaticsTranscriptionService {
	if (!_speechmaticsInstance) {
		_speechmaticsInstance = new SpeechmaticsTranscriptionService();
	}
	return _speechmaticsInstance;
}
