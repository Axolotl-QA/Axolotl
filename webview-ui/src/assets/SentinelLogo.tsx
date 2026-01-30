import { SVGProps } from "react"
import type { Environment } from "../../../src/config"

/**
 * SentinelLogo component renders the Sentinel eye logo
 * Green triangle with rounded corners and a centered eye design
 */
const SentinelLogo = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => {
	const { environment: _environment, ...svgProps } = props

	// Color scheme matching the new Sentinel design
	const triangleColor = "#7DD3A0" // Soft green
	const eyeRingColor = "#2D5A4A" // Dark teal/green
	const eyeWhite = "#FFFFFF"
	const pupilColor = "#2D5A4A" // Dark teal/green
	const highlightColor = "#FFFFFF"

	return (
		<svg viewBox="0 0 100 100" width="50" height="50" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			{/* Drop shadow filter */}
			<defs>
				<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
					<feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.15" />
				</filter>
			</defs>

			{/* Green triangle with rounded corners */}
			<path
				d="M50 12 
				   C52 12, 54 13, 55 15
				   L87 72
				   C89 75, 88 79, 85 81
				   L15 81
				   C12 79, 11 75, 13 72
				   L45 15
				   C46 13, 48 12, 50 12 Z"
				fill={triangleColor}
				filter="url(#shadow)"
			/>

			{/* Outer eye ring */}
			<circle cx="50" cy="54" r="22" fill={eyeRingColor} />

			{/* White of the eye */}
			<circle cx="50" cy="54" r="18" fill={eyeWhite} />

			{/* Pupil */}
			<circle cx="50" cy="54" r="12" fill={pupilColor} />

			{/* Eye highlight */}
			<circle cx="45" cy="50" r="4" fill={highlightColor} opacity="0.9" />
		</svg>
	)
}
export default SentinelLogo
