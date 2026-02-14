import { SVGProps } from "react"
import type { Environment } from "../../../src/config"

const AxolotlLogo = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => {
	const { environment: _environment, ...svgProps } = props

	return (
		<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			<rect x="8" y="8" width="112" height="112" rx="18" fill="#5065F6" />
			<ellipse cx="50" cy="57" rx="27" ry="31" fill="#EFEFEF" />
			<path d="M60 52C72 43 88 45 97 54C106 63 108 82 97 93C85 104 66 103 56 90C47 79 49 60 60 52Z" fill="#EFEFEF" />
			<ellipse cx="97" cy="57" rx="10" ry="6" fill="#EFEFEF" />
			<path d="M77 84C84 92 92 96 103 97" stroke="#B6B7BB" strokeWidth="4" strokeLinecap="round" />
			<path d="M70 77C75 83 80 87 88 91" stroke="#B6B7BB" strokeWidth="4" strokeLinecap="round" />
			<ellipse cx="55" cy="88" rx="5" ry="10" fill="#EFEFEF" />
			<ellipse cx="85" cy="96" rx="11" ry="5" fill="#EFEFEF" />
		</svg>
	)
}

export default AxolotlLogo
