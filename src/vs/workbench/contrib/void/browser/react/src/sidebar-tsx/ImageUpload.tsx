/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useRef, useState } from 'react';
import { ImageAttachment } from '../../../common/chatThreadServiceTypes.js';
import { Plus, X } from 'lucide-react';

const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp'];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

// Note: BMP is supported by OpenAI-compatible providers but not Anthropic/Gemini

// Shared hook for file processing logic
export const useImageUpload = (
	images: ImageAttachment[],
	onImagesChange: (images: ImageAttachment[]) => void,
	maxImages: number = 10
) => {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [error, setError] = useState<string | null>(null);

	const processClipboardItems = async (items: DataTransferItemList) => {
		setError(null);

		const imageFiles: File[] = [];
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item.type.startsWith('image/')) {
				const file = item.getAsFile();
				if (file) {
					imageFiles.push(file);
				}
			}
		}

		if (imageFiles.length > 0) {
			await processFiles(imageFiles);
			return true; // Image was pasted
		}
		return false; // No image pasted
	};

	const processFiles = async (files: FileList | File[]) => {
		setError(null);

		const newImages: ImageAttachment[] = [];
		const fileArray = Array.from(files);

		for (let i = 0; i < fileArray.length; i++) {
			const file = fileArray[i];

			// Validate file type
			if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
				setError(`Unsupported file type: ${file.name}. Supported: PNG, JPEG, GIF, WebP, BMP (note: BMP only works with OpenAI providers)`);
				continue;
			}

			// Validate file size
			if (file.size > MAX_IMAGE_SIZE) {
				setError(`File too large: ${file.name}. Max size: 20MB`);
				continue;
			}

			try {
				const base64 = await readFileAsBase64(file);
				const dimensions = await getImageDimensions(base64, file.type);

				newImages.push({
					data: base64,
					mimeType: file.type as any,
					fileName: file.name,
					width: dimensions.width,
					height: dimensions.height,
				});
			} catch (err) {
				console.error('Failed to read image:', err);
				setError(`Failed to read ${file.name}`);
			}
		}

		const combined = [...images, ...newImages].slice(0, maxImages);
		onImagesChange(combined);

		// Reset file input
		if (fileInputRef.current) {
			fileInputRef.current.value = '';
		}
	};

	const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files;
		if (!files || files.length === 0) return;
		await processFiles(files);
	};

	const removeImage = (index: number) => {
		onImagesChange(images.filter((_, i) => i !== index));
		setError(null);
	};

	const handleClick = () => {
		fileInputRef.current?.click();
	};

	return {
		fileInputRef,
		error,
		setError,
		processFiles,
		processClipboardItems,
		handleFileSelect,
		removeImage,
		handleClick,
	};
};

// Button component for attaching images
interface ImageUploadButtonProps {
	images: ImageAttachment[];
	onImagesChange: (images: ImageAttachment[]) => void;
	maxImages?: number;
}

export const ImageUploadButton: React.FC<ImageUploadButtonProps> = ({ images, onImagesChange, maxImages = 10 }) => {
	const { fileInputRef, handleFileSelect, handleClick } = useImageUpload(images, onImagesChange, maxImages);

	return (
		<>
			<button
				type="button"
				onClick={handleClick}
				disabled={images.length >= maxImages}
				style={{
					display: 'inline-flex',
					alignItems: 'center',
					justifyContent: 'center',
					width: '28px',
					height: '28px',
					padding: '0',
					borderRadius: '4px',
					border: 'none',
					background: 'transparent',
					color: 'var(--vscode-foreground)',
					cursor: images.length >= maxImages ? 'not-allowed' : 'pointer',
					opacity: images.length >= maxImages ? 0.3 : 0.7,
				}}
				onMouseEnter={(e) => {
					if (images.length < maxImages) {
						e.currentTarget.style.background = 'var(--vscode-toolbar-hoverBackground)';
						e.currentTarget.style.opacity = '1';
					}
				}}
				onMouseLeave={(e) => {
					e.currentTarget.style.background = 'transparent';
					e.currentTarget.style.opacity = images.length >= maxImages ? '0.3' : '0.7';
				}}
				title={images.length >= maxImages ? `Maximum ${maxImages} images` : 'Attach images'}
			>
				<Plus size={18} />
			</button>

			<input
				ref={fileInputRef}
				type="file"
				accept={SUPPORTED_IMAGE_TYPES.join(',')}
				multiple
				onChange={handleFileSelect}
				style={{ display: 'none' }}
			/>
		</>
	);
};

// Previews component for displaying uploaded images
interface ImagePreviewsListProps {
	images: ImageAttachment[];
	onRemove: (index: number) => void;
}

export const ImagePreviewsList: React.FC<ImagePreviewsListProps> = ({ images, onRemove }) => {
	if (images.length === 0) return null;

	return (
		<div style={{
			display: 'flex',
			flexWrap: 'wrap',
			gap: '8px',
			padding: '0 0 8px 0',
			justifyContent: 'flex-end',
		}}>
			{images.map((img, idx) => (
				<ImagePreview
					key={idx}
					img={img}
					idx={idx}
					onRemove={() => onRemove(idx)}
				/>
			))}
		</div>
	);
};

// Combined component (for backward compatibility)
interface ImageUploadProps {
	images: ImageAttachment[];
	onImagesChange: (images: ImageAttachment[]) => void;
	maxImages?: number;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({ images, onImagesChange, maxImages = 10 }) => {
	return (
		<ImageUploadButton
			images={images}
			onImagesChange={onImagesChange}
			maxImages={maxImages}
		/>
	);
};

// Drop zone overlay for drag and drop
interface ImageDropZoneProps {
	images: ImageAttachment[];
	onImagesChange: (images: ImageAttachment[]) => void;
	maxImages?: number;
	children: React.ReactNode;
}

// Hook that returns drag/drop and paste handlers
export const useImageDropZone = (
	images: ImageAttachment[],
	onImagesChange: (images: ImageAttachment[]) => void,
	maxImages: number = 10
) => {
	const { processFiles, processClipboardItems, setError } = useImageUpload(images, onImagesChange, maxImages);
	const [isDragging, setIsDragging] = useState(false);
	const dragCounter = useRef(0);

	const handlePaste = async (e: React.ClipboardEvent) => {
		if (images.length >= maxImages) {
			setError(`Maximum ${maxImages} images reached`);
			return;
		}

		if (e.clipboardData && e.clipboardData.items) {
			const hadImage = await processClipboardItems(e.clipboardData.items);
			if (hadImage) {
				e.preventDefault(); // Only prevent default if we handled an image
			}
		}
	};

	const handleDragEnter = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current++;
		if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
			setIsDragging(true);
		}
	};

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
	};

	const handleDragLeave = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current--;
		if (dragCounter.current === 0) {
			setIsDragging(false);
		}
	};

	const handleDrop = async (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(false);
		dragCounter.current = 0;

		if (images.length >= maxImages) {
			setError(`Maximum ${maxImages} images reached`);
			return;
		}

		const files = e.dataTransfer.files;
		if (files && files.length > 0) {
			await processFiles(files);
		}
	};

	const dragOverlay = isDragging ? (
		<div style={{
			position: 'absolute',
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			background: 'var(--vscode-list-dropBackground)',
			border: '2px dashed var(--vscode-focusBorder)',
			borderRadius: '12px',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			zIndex: 1000,
			pointerEvents: 'none',
		}}>
			<div style={{
				fontSize: '14px',
				color: 'var(--vscode-foreground)',
				fontWeight: 500,
			}}>
				Drop images here
			</div>
		</div>
	) : null;

	return {
		isDragging,
		dragOverlay,
		handlers: {
			onDragEnter: handleDragEnter,
			onDragOver: handleDragOver,
			onDragLeave: handleDragLeave,
			onDrop: handleDrop,
			onPaste: handlePaste,
		}
	};
};

// Wrapper component (deprecated - use useImageDropZone hook instead)
export const ImageDropZone: React.FC<ImageDropZoneProps> = ({ images, onImagesChange, maxImages = 10, children }) => {
	const { dragOverlay, handlers } = useImageDropZone(images, onImagesChange, maxImages);

	return (
		<div style={{ position: 'relative' }} {...handlers}>
			{children}
			{dragOverlay}
		</div>
	);
};

// Helper function to read file as base64 (without data:... prefix)
function readFileAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			// Remove the data URL prefix (data:image/png;base64,)
			const base64 = result.split(',')[1];
			resolve(base64);
		};
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

// Helper function to get image dimensions
function getImageDimensions(base64: string, mimeType: string): Promise<{ width: number; height: number }> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			resolve({ width: img.width, height: img.height });
		};
		img.onerror = reject;
		img.src = `data:${mimeType};base64,${base64}`;
	});
}

// Image preview component with hover state
interface ImagePreviewProps {
	img: ImageAttachment;
	idx: number;
	onRemove: () => void;
}

const ImagePreview: React.FC<ImagePreviewProps> = ({ img, idx, onRemove }) => {
	const [isHovered, setIsHovered] = useState(false);

	return (
		<div
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			style={{
				position: 'relative',
				width: '80px',
				height: '80px',
				borderRadius: '4px',
				overflow: 'hidden',
				border: '1px solid var(--vscode-widget-border)',
			}}
		>
			<img
				src={`data:${img.mimeType};base64,${img.data}`}
				alt={img.fileName || `Image ${idx + 1}`}
				style={{
					width: '100%',
					height: '100%',
					objectFit: 'cover',
				}}
			/>
			{/* Remove button */}
			<button
				type="button"
				onClick={onRemove}
				style={{
					position: 'absolute',
					top: '4px',
					right: '4px',
					padding: '2px',
					borderRadius: '4px',
					background: 'var(--vscode-button-background)',
					color: 'var(--vscode-button-foreground)',
					border: 'none',
					cursor: 'pointer',
					opacity: isHovered ? 1 : 0,
					transition: 'opacity 0.2s',
				}}
				onMouseEnter={(e) => {
					e.currentTarget.style.background = 'var(--vscode-button-hoverBackground)';
				}}
				onMouseLeave={(e) => {
					e.currentTarget.style.background = 'var(--vscode-button-background)';
				}}
				title="Remove image"
			>
				<X size={12} />
			</button>
			{/* File name tooltip */}
			<div style={{
				position: 'absolute',
				bottom: 0,
				left: 0,
				right: 0,
				background: 'rgba(0, 0, 0, 0.75)',
				color: 'white',
				fontSize: '10px',
				padding: '2px 4px',
				overflow: 'hidden',
				textOverflow: 'ellipsis',
				whiteSpace: 'nowrap',
				opacity: isHovered ? 1 : 0,
				transition: 'opacity 0.2s',
			}}>
				{img.fileName || 'image'}
			</div>
		</div>
	);
};

// Component to display images in chat history
interface ChatImageDisplayProps {
	images: ImageAttachment[];
}

export const ChatImageDisplay: React.FC<ChatImageDisplayProps> = ({ images }) => {
	if (!images || images.length === 0) return null;

	return (
		<div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '8px 0' }}>
			{images.map((img, idx) => (
				<div
					key={idx}
					style={{
						position: 'relative',
						maxWidth: '200px',
						maxHeight: '200px',
						borderRadius: '4px',
						overflow: 'hidden',
						border: '1px solid var(--vscode-widget-border)',
						cursor: 'pointer',
					}}
					onMouseEnter={(e) => {
						e.currentTarget.style.opacity = '0.9';
					}}
					onMouseLeave={(e) => {
						e.currentTarget.style.opacity = '1';
					}}
					title={img.fileName || `Image ${idx + 1}`}
				>
					<img
						src={`data:${img.mimeType};base64,${img.data}`}
						alt={img.fileName || `Image ${idx + 1}`}
						style={{
							width: '100%',
							height: '100%',
							objectFit: 'contain',
						}}
					/>
				</div>
			))}
		</div>
	);
};
