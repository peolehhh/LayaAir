import { LayaGL } from "../../layagl/LayaGL";
import { RenderTextureDepthFormat } from "../../resource/RenderTextureFormat";
import { BaseCamera } from "../core/BaseCamera";
import { Camera } from "../core/Camera";
import { DirectionLight } from "../core/light/DirectionLight";
import { ShadowMode } from "../core/light/ShadowMode";
import { ShadowUtils } from "../core/light/ShadowUtils";
import { Scene3D } from "../core/scene/Scene3D";
import { Scene3DShaderDeclaration } from "../core/scene/Scene3DShaderDeclaration";
import { BoundSphere } from "../math/BoundSphere";
import { MathUtils3D } from "../math/MathUtils3D";
import { Matrix4x4 } from "../math/Matrix4x4";
import { Vector3 } from "../math/Vector3";
import { Vector4 } from "../math/Vector4";
import { RenderTexture } from "../resource/RenderTexture";
import { Shader3D } from "../shader/Shader3D";
import { ShaderData } from "../shader/ShaderData";
import { ShadowSliceData } from "./ShadowSliceData";
import { ShadowCascadesMode } from "../core/light/ShadowCascadesMode";
import { LightSprite } from "../core/light/LightSprite";

/**
 * 
 */
export class ShadowCasterPass {
	/**@internal */
	static _tempVector30: Vector3 = new Vector3();
	/**@internal */
	static _tempVector31: Vector3 = new Vector3();
	/**@internal */
	static _tempVector32: Vector3 = new Vector3();
	/**@internal */
	static _tempBoundSphere0: BoundSphere = new BoundSphere(new Vector3(), 0);
	/**@internal */
	static _tempMatrix0: Matrix4x4 = new Matrix4x4();

	/**@internal */
	static SHADOW_BIAS: number = Shader3D.propertyNameToID("u_ShadowBias");
	/**@internal */
	static SHADOW_LIGHT_DIRECTION: number = Shader3D.propertyNameToID("u_ShadowLightDirection");
	/**@internal */
	static SHADOWDISTANCE: number = Shader3D.propertyNameToID("u_shadowPSSMDistance");
	/**@internal */
	static SHADOWLIGHT_VIEW_PROJECTS: number = Shader3D.propertyNameToID("u_ShadowLightViewProjects");
	/**@internal */
	static SHADOW_MAP_SIZE: number = Shader3D.propertyNameToID("u_ShadowMapSize");
	/**@internal */
	static SHADOW_MAP: number = Shader3D.propertyNameToID("u_ShadowMap");
	/**@internal */
	static SHADOW_PARAMS: number = Shader3D.propertyNameToID("u_ShadowParams");

	/**@internal */
	static _maxCascades: number = 4;

	/** */
	_shadowMap: RenderTexture;
	/**@internal */
	_shadowMapWith: number = 0;
	/**@internal */
	_shadowMapHeight: number = 0;
	/**@internal */
	_cascadeCount: number = 0;
	/**@internal */
	_shadowSliceDatas: ShadowSliceData[] = [new ShadowSliceData(), new ShadowSliceData(), new ShadowSliceData(), new ShadowSliceData()];
	/**@internal */
	_cascadeSplitDistances: Vector4[] = [new Vector4(), new Vector4(), new Vector4(), new Vector4()];
	/**@internal */
	_shadowMatrix: Matrix4x4[] = [new Matrix4x4(), new Matrix4x4(), new Matrix4x4(), new Matrix4x4(), new Matrix4x4()];






	/**@internal */
	_light: DirectionLight;
	/** @internal */
	private _shadowMapSize: Vector4 = new Vector4();
	/** @internal */
	private _shadowParams: Vector4 = new Vector4();
	/** @internal */
	private _shaderValueDistance: Vector4 = new Vector4();
	/** @internal */
	private _shaderValueLightVP: Float32Array = null;
	/** @internal */
	private _shaderValueVPs: Float32Array[];
	/** @internal */
	private _shadowBias: Vector4 = new Vector4();
	/**@internal */
	private _projectViewMatrix: Matrix4x4 = new Matrix4x4();

	constructor() {
		this._shaderValueVPs = [];
		this._shaderValueLightVP = new Float32Array(4 * 16);
		this._shaderValueVPs.length = 4;
		for (var i: number = 0; i < 4; i++)
			this._shaderValueVPs[i] = new Float32Array(this._shaderValueLightVP.buffer, i * 64);
	}
	/**
	 * @internal
	 */
	_update(index: number, sceneCamera: Camera): void {
		var shaderValues: ShaderData = (<Scene3D>this._light._scene)._shaderValues;
		this._setupShadowReceiverShaderValues(shaderValues);
		var viewMatrix: Matrix4x4 = this._shadowSliceDatas[0].viewMatrix;
		var projectMatrix: Matrix4x4 = this._shadowSliceDatas[0].projectionMatrix;
		this._getLightViewProject(sceneCamera, viewMatrix, projectMatrix);

		ShadowUtils.getShadowBias(this._light, projectMatrix, this._light._shadowResolution, this._shadowBias);
		this._light.transform.worldMatrix.getForward(this._light._direction);
		Vector3.normalize(this._light._direction, this._light._direction);
		this._setupShadowCasterShaderValues(shaderValues, this._light._direction, this._shadowBias, viewMatrix, projectMatrix);
	}

	/**
	 * @internal
	 */
	private _getLightViewProject(sceneCamera: Camera, viewMatrix: Matrix4x4, projectMatrix: Matrix4x4): void {
		var boundSphere: BoundSphere = ShadowCasterPass._tempBoundSphere0;
		var forward: Vector3 = ShadowCasterPass._tempVector30;
		sceneCamera._transform.getForward(forward);//TODO:normalize测试
		ShadowUtils.getBoundSphereByFrustum(sceneCamera.nearPlane, Math.min(sceneCamera.farPlane, this._light._shadowDistance), sceneCamera.fieldOfView * MathUtils3D.Deg2Rad,
			sceneCamera.aspectRatio, sceneCamera._transform.position, forward, boundSphere);

		var lightWorld: Matrix4x4 = this._light._transform.worldMatrix;
		var lightUp: Vector3 = ShadowCasterPass._tempVector32;
		var lightSide: Vector3 = ShadowCasterPass._tempVector31;
		var lightForward: Vector3 = ShadowCasterPass._tempVector30;
		lightSide.setValue(lightWorld.getElementByRowColumn(0, 0), lightWorld.getElementByRowColumn(0, 1), lightWorld.getElementByRowColumn(0, 2));
		lightUp.setValue(lightWorld.getElementByRowColumn(1, 0), lightWorld.getElementByRowColumn(1, 1), lightWorld.getElementByRowColumn(1, 2));
		lightForward.setValue(-lightWorld.getElementByRowColumn(2, 0), -lightWorld.getElementByRowColumn(2, 1), -lightWorld.getElementByRowColumn(2, 2));
		Vector3.normalize(lightUp, lightUp);
		Vector3.normalize(lightSide, lightSide);
		Vector3.normalize(lightForward, lightForward);

		var sizeSM: number = this._light._shadowResolution;
		for (var i: number = 0; i < 1; i++) {//TODO: split
			var center: Vector3 = boundSphere.center;
			var radius: number = boundSphere.radius;
			var diam: number = radius * 2.0;
			var sizeUnit: number = sizeSM / diam;
			var radiusUnit: number = diam / sizeSM;

			// to solve shdow swimming problem
			var upLen: number = Math.ceil(Vector3.dot(center, lightUp) * sizeUnit) * radiusUnit;
			var sideLen: number = Math.ceil(Vector3.dot(center, lightSide) * sizeUnit) * radiusUnit;
			var forwardLen: number = Vector3.dot(center, lightForward);

			center.x = lightUp.x * upLen + lightSide.x * sideLen + lightForward.x * forwardLen;
			center.y = lightUp.y * upLen + lightSide.y * sideLen + lightForward.y * forwardLen;
			center.z = lightUp.z * upLen + lightSide.z * sideLen + lightForward.z * forwardLen;

			//direction light use shadow pancaking tech,do special dispose with nearPlane.
			var nearPlane: number = this._light.shadowNearPlane;
			var origin: Vector3 = this._shadowSliceDatas[i].position;
			var projectViewMatrix: Matrix4x4 = ShadowCasterPass._tempMatrix0;

			Vector3.scale(lightForward, radius + nearPlane, origin);
			Vector3.subtract(center, origin, origin);
			Matrix4x4.createLookAt(origin, center, lightUp, viewMatrix);
			Matrix4x4.createOrthoOffCenter(-radius, radius, -radius, radius, 0.0, diam, projectMatrix);
			Matrix4x4.multiply(projectMatrix, viewMatrix, projectViewMatrix);
			this._shadowSliceDatas[i].boundFrustum.matrix = projectViewMatrix;

			ShadowCasterPass.multiplyMatrixOutFloat32Array(ShadowUtils._shadowMapScaleOffsetMatrix, projectViewMatrix, this._shaderValueVPs[0]);
		}
	}


	/**
	 * 计算两个矩阵的乘法
	 * @param	left left矩阵
	 * @param	right  right矩阵
	 * @param	out  输出矩阵
	 */
	static multiplyMatrixOutFloat32Array(left: Matrix4x4, right: Matrix4x4, out: Float32Array): void {
		var i: number, a: Float32Array, b: Float32Array, ai0: number, ai1: number, ai2: number, ai3: number;
		a = left.elements;
		b = right.elements;
		for (i = 0; i < 4; i++) {
			ai0 = a[i];
			ai1 = a[i + 4];
			ai2 = a[i + 8];
			ai3 = a[i + 12];
			out[i] = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3];
			out[i + 4] = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7];
			out[i + 8] = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11];
			out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
		}
	}

	/**
	 * @internal
	 */
	start(): void {
		var shadowMapSize: number = this._light._shadowResolution;
		var shadowMap: RenderTexture = ShadowUtils.getTemporaryShadowTexture(shadowMapSize, shadowMapSize, RenderTextureDepthFormat.DEPTH_16);
		var sceneSV: ShaderData = (<Scene3D>this._light._scene)._shaderValues;
		sceneSV.setTexture(ShadowCasterPass.SHADOW_MAP, shadowMap);
		shadowMap._start();
		this._shadowMap = shadowMap;
	}


	//TOOD:TEMP
	tempViewPort(): void {
		var gl = LayaGL.instance;
		LayaGL.instance.viewport(0, 0, this._shadowMap.width, this._shadowMap.height);
		gl.enable(gl.SCISSOR_TEST);
		LayaGL.instance.scissor(0, 0, this._shadowMap.width, this._shadowMap.height);
		gl.clearColor(1, 1, 1, 1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	}

	/**
	 * @internal
	 */
	end(): void {
		var gl = LayaGL.instance;
		this._shadowMap._end();
		gl.disable(gl.SCISSOR_TEST);
	}

	/**
	 * @internal
	 */
	clear(): void {
		RenderTexture.recoverToPool(this._shadowMap);
		// this._shadowMap = null; TODO:
	}

	/**
     * @internal
     */
	private _setupShadowCasterShaderValues(shaderValues: ShaderData, direction: Vector3, shadowBias: Vector4, viewMatrix: Matrix4x4, projectMatrix: Matrix4x4): void {
		Matrix4x4.multiply(projectMatrix, viewMatrix, this._projectViewMatrix);
		shaderValues.setVector(ShadowCasterPass.SHADOW_BIAS, shadowBias);
		shaderValues.setVector3(ShadowCasterPass.SHADOW_LIGHT_DIRECTION, direction);

		var cameraSV: ShaderData = this._shadowSliceDatas[0].cameraShaderBalue;//TODO:
		cameraSV.setMatrix4x4(BaseCamera.VIEWMATRIX, viewMatrix);
		cameraSV.setMatrix4x4(BaseCamera.PROJECTMATRIX, projectMatrix);
		cameraSV.setMatrix4x4(BaseCamera.VIEWPROJECTMATRIX, this._projectViewMatrix);
	}

	/**
	 * @internal
	 */
	private _setupShadowReceiverShaderValues(shaderValues: ShaderData): void {
		var light: DirectionLight = this._light;
		
		if (light.shadowCascadesMode !== ShadowCascadesMode.NoCascades)
			shaderValues.addDefine(Scene3DShaderDeclaration.SHADERDEFINE_SHADOW_CASCADES);
		else
			shaderValues.removeDefine(Scene3DShaderDeclaration.SHADERDEFINE_SHADOW_CASCADES);
		
		switch (light.shadowMode) {
			case ShadowMode.Hard:
				shaderValues.removeDefine(Scene3DShaderDeclaration.SHADERDEFINE_SHADOW_SOFT_SHADOW_LOW);
				shaderValues.removeDefine(Scene3DShaderDeclaration.SHADERDEFINE_SHADOW_SOFT_SHADOW_HIGH);
				break;
			case ShadowMode.SoftLow:
				shaderValues.addDefine(Scene3DShaderDeclaration.SHADERDEFINE_SHADOW_SOFT_SHADOW_LOW);
				shaderValues.removeDefine(Scene3DShaderDeclaration.SHADERDEFINE_SHADOW_SOFT_SHADOW_HIGH);
				break;
			case ShadowMode.SoftHigh:
				shaderValues.addDefine(Scene3DShaderDeclaration.SHADERDEFINE_SHADOW_SOFT_SHADOW_HIGH);
				shaderValues.removeDefine(Scene3DShaderDeclaration.SHADERDEFINE_SHADOW_SOFT_SHADOW_LOW);
				break;
		}
		var shadowMapSize: number = light._shadowResolution;
		this._shadowMapSize.setValue(1.0 / shadowMapSize, 1.0 / shadowMapSize, shadowMapSize, shadowMapSize);
		shaderValues.setVector(ShadowCasterPass.SHADOWDISTANCE, this._shaderValueDistance);
		shaderValues.setBuffer(ShadowCasterPass.SHADOWLIGHT_VIEW_PROJECTS, this._shaderValueLightVP);
		shaderValues.setVector(ShadowCasterPass.SHADOW_MAP_SIZE, this._shadowMapSize);
		this._shadowParams.setValue(light._shadowStrength, 0.0, 0.0, 0.0);
		shaderValues.setVector(ShadowCasterPass.SHADOW_PARAMS, this._shadowParams);
	}
}

