import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType

plugins {
    id("org.jetbrains.kotlin.jvm") version "2.2.20"
    id("org.jetbrains.kotlin.plugin.serialization") version "2.2.20"
    id("org.jetbrains.intellij.platform") version "2.12.0"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2025.1")
        jetbrainsRuntime()
    }
    implementation("com.agentclientprotocol:acp:0.18.0") {
        exclude(group = "org.jetbrains.kotlin", module = "kotlin-stdlib")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-coroutines-bom")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-coroutines-core")
        exclude(group = "org.jetbrains.kotlinx", module = "kotlinx-coroutines-core-jvm")
    }
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    implementation("io.github.java-diff-utils:java-diff-utils:4.15")
    testImplementation(kotlin("test-junit"))
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        freeCompilerArgs.add("-Xjvm-default=all")
    }
    sourceSets["main"].kotlin.srcDir(layout.buildDirectory.dir("generated/buildConfig"))
}

intellijPlatform {
    buildSearchableOptions = false
    signing {
        privateKeyFile.set(layout.projectDirectory.file("signing/private.pem"))
        certificateChainFile.set(layout.projectDirectory.file("signing/chain.crt"))
    }
    pluginVerification {
        ides {
            create(IntelliJPlatformType.IntellijIdeaCommunity, "2025.1")
            create(IntelliJPlatformType.PhpStorm, "2026.1")
        }
    }
}

val devMode = providers.gradleProperty("devMode").map { it.toBoolean() }.getOrElse(false)

val generateBuildConfig by tasks.registering {
    val outputDir = layout.buildDirectory.dir("generated/buildConfig")
    val isDev = devMode
    outputs.dir(outputDir)
    doLast {
        val file = outputDir.get().asFile.resolve("agentdock/BuildConfig.kt")
        file.parentFile.mkdirs()
        file.writeText("package agentdock\n\ninternal object BuildConfig {\n    const val IS_DEV: Boolean = $isDev\n}\n")
    }
}

tasks {
    val npm = if (org.gradle.internal.os.OperatingSystem.current().isWindows) "npm.cmd" else "npm"

    val npmBuild by registering(Exec::class) {
        workingDir = file("frontend")
        commandLine(npm, "run", "build")
    }

    compileKotlin {
        dependsOn(generateBuildConfig)
    }

    processResources {
        dependsOn(npmBuild)
    }

}
